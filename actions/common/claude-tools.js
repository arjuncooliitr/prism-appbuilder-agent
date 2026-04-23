/**
 * Claude tool-use loop for Prism's fix-issue action.
 *
 * Exposes four tools to Claude:
 *   - list_files(pattern?)   — returns file paths in the target repo
 *   - read_file(path)         — returns file contents (cached after first read)
 *   - propose_edit(path, new_content, reason)   — stages a file edit
 *   - abort(reason)           — cleanly abandons the fix with a reason
 *
 * Runs a message loop: each response with stop_reason=tool_use triggers
 * execution of the requested tools and continues until Claude emits a final
 * text response or calls abort.
 *
 * The loop is bounded (max 10 iterations) to prevent runaway cost.
 */

const TOOLS = [
  {
    name: 'list_files',
    description: 'List files in the target repo. Optional `pattern` is a simple substring filter on paths. Returns at most 200 paths sorted alphabetically. Use this to discover where the issue likely lives.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Optional substring to filter file paths by.' }
      }
    }
  },
  {
    name: 'search_content',
    description: 'Search file contents for a literal string across the repo (grep). Returns up to 20 matches with {path, line, snippet}. Use this when the issue mentions a specific URL, symbol, or phrase but not which file contains it — e.g. "replace https://old.example.com" or "fix typo \\"teh\\"". Much more efficient than read_file-ing many files.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal string to search for.' },
        path_filter: { type: 'string', description: 'Optional substring filter on file paths to narrow the search (e.g. "docs/" or ".md").' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_file',
    description: 'Read the full contents of a file at the given path. Returns the text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to repo root.' }
      },
      required: ['path']
    }
  },
  {
    name: 'propose_edit',
    description: 'Stage a file edit. The `new_content` fully replaces the existing file. Include a one-sentence `reason` explaining why this change fixes the issue.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        new_content: { type: 'string', description: 'Complete new contents of the file.' },
        reason: { type: 'string', description: 'One sentence explaining the change.' }
      },
      required: ['path', 'new_content', 'reason']
    }
  },
  {
    name: 'abort',
    description: 'Cleanly abandon the fix. Use when the issue is ambiguous, the fix would span too many files, or you cannot locate the relevant code. Provide a clear `reason`.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' }
      },
      required: ['reason']
    }
  }
]

const MAX_ITERATIONS = 15
const MAX_TREE_FILES = 200
const FILE_SIZE_CAP = 200 * 1024 // 200KB hard cap on files we'll read
const SEARCH_FILE_CAP = 80        // don't read more than this many files in one search
const SEARCH_RESULT_CAP = 20      // return at most this many matches
const SEARCH_SNIPPET_BEFORE = 40  // chars of context before/after the match

/**
 * Normalize a proposed edit:
 *   - Always ensure a trailing '\n' on non-empty content. Nearly every text
 *     file should end with one (POSIX, ESLint eol-last, PEP 8 W292). Crucially
 *     this also fixes a common LLM failure: Claude often emits "new_content"
 *     without a trailing newline even when asked to preserve it, and without
 *     this normalization the lint rule stays red forever. If the file already
 *     lacks a trailing newline AND the issue is eol-last, adding one fixes it.
 *   - If the result is byte-identical to the original, mark it as a no-op so
 *     the caller can drop it before committing (prevents empty commits).
 */
function normalizeEdit (original, proposed) {
  let content = proposed
  if (content.length > 0 && !content.endsWith('\n')) {
    content = content + '\n'
  }
  if (original == null) return { content, noop: false }
  return { content, noop: content === original }
}

/**
 * Runs the tool-use loop and returns the final result.
 * @param {object} claudeClient — Bedrock Claude client
 * @param {object} ghAccess — helpers bound to one repo
 *   { listAll(), readFile(path), owner, repo }
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.systemPrompt — cacheable, describes the task
 * @param {string} opts.userMessage — issue-specific instructions
 * @param {number} [opts.maxTokens=4096]
 * @returns {Promise<{ edits: Array, aborted: boolean, abortReason?: string, finalText: string, iterations: number, usage: object }>}
 */
async function runFixLoop (claudeClient, ghAccess, { model, systemPrompt, userMessage, maxTokens = 4096 }) {
  const messages = [{ role: 'user', content: userMessage }]
  const edits = []
  let aborted = false
  let abortReason = null
  let finalText = ''
  let iterations = 0
  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

  while (iterations < MAX_ITERATIONS) {
    iterations++
    const response = await claudeClient.messages.create({
      model,
      max_tokens: maxTokens,
      tools: TOOLS,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages
    })

    // accumulate usage
    const u = response.usage || {}
    totalUsage.input_tokens += u.input_tokens || 0
    totalUsage.output_tokens += u.output_tokens || 0
    totalUsage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0
    totalUsage.cache_read_input_tokens += u.cache_read_input_tokens || 0

    // Collect any text blocks for logging
    const textParts = (response.content || []).filter(b => b.type === 'text').map(b => b.text)
    if (textParts.length) finalText = textParts.join('\n')

    if (response.stop_reason !== 'tool_use') {
      break
    }

    // Run each tool call
    const toolUses = (response.content || []).filter(b => b.type === 'tool_use')
    const toolResults = []

    for (const tu of toolUses) {
      let result
      try {
        switch (tu.name) {
          case 'list_files': {
            const pattern = (tu.input && tu.input.pattern) || ''
            const all = await ghAccess.listAll()
            let filtered = pattern ? all.filter(p => p.includes(pattern)) : all
            const truncated = filtered.length > MAX_TREE_FILES
            if (truncated) filtered = filtered.slice(0, MAX_TREE_FILES)
            result = { files: filtered, truncated, total_matches: pattern ? filtered.length : all.length }
            break
          }
          case 'read_file': {
            const path = tu.input && tu.input.path
            if (!path) { result = { error: 'path is required' }; break }
            try {
              const { content, sha } = await ghAccess.readFile(path)
              if (content.length > FILE_SIZE_CAP) {
                result = { error: `file too large (${content.length} bytes, cap ${FILE_SIZE_CAP})` }
              } else {
                result = { content, sha, path }
              }
            } catch (e) {
              result = { error: `could not read ${path}: ${e.message}` }
            }
            break
          }
          case 'search_content': {
            const query = tu.input && tu.input.query
            const pathFilter = tu.input && tu.input.path_filter
            if (!query) { result = { error: 'query is required' }; break }
            const all = await ghAccess.listAll()
            let candidates = pathFilter ? all.filter(p => p.includes(pathFilter)) : all
            // Heuristic narrowing: skip binary-ish paths and oversized dirs
            candidates = candidates.filter(p => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|mp4|mov|zip|tar|gz|pdf)$/i.test(p))
            const scanned = candidates.slice(0, SEARCH_FILE_CAP)
            const matches = []
            for (const p of scanned) {
              if (matches.length >= SEARCH_RESULT_CAP) break
              let content
              try { content = (await ghAccess.readFile(p)).content } catch (_) { continue }
              if (content.length > FILE_SIZE_CAP) continue
              let idx = content.indexOf(query)
              while (idx !== -1 && matches.length < SEARCH_RESULT_CAP) {
                const before = content.slice(0, idx)
                const lineNum = (before.match(/\n/g) || []).length + 1
                const snippetStart = Math.max(0, idx - SEARCH_SNIPPET_BEFORE)
                const snippetEnd = Math.min(content.length, idx + query.length + SEARCH_SNIPPET_BEFORE)
                matches.push({
                  path: p,
                  line: lineNum,
                  snippet: content.slice(snippetStart, snippetEnd).replace(/\n/g, '\\n')
                })
                idx = content.indexOf(query, idx + query.length)
              }
            }
            result = {
              query,
              matches,
              files_scanned: scanned.length,
              files_total: candidates.length,
              scan_truncated: candidates.length > SEARCH_FILE_CAP
            }
            break
          }
          case 'propose_edit': {
            const { path, new_content, reason } = tu.input || {}
            if (!path || typeof new_content !== 'string') {
              result = { error: 'path and new_content are required' }
              break
            }
            // Check against the branch's current content so we can (a) preserve
            // a trailing newline the file had before and (b) detect no-op
            // proposals that would create empty commits.
            let original = null
            try { const r = await ghAccess.readFile(path); original = r.content } catch (_) { /* new file */ }
            const { content: normalized, noop } = normalizeEdit(original, new_content)
            if (noop) {
              result = { error: `proposed content is byte-identical to the file already on the branch — no edit needed. Either call abort with reason "requested change already present on branch", or propose a different change.` }
              break
            }
            edits.push({ path, new_content: normalized, reason: reason || '' })
            result = { ok: true, staged_edits: edits.length, trailing_newline_preserved: normalized.endsWith('\n') }
            break
          }
          case 'abort': {
            aborted = true
            abortReason = (tu.input && tu.input.reason) || 'unspecified'
            result = { ok: true, message: 'Fix abandoned.' }
            break
          }
          default:
            result = { error: `unknown tool: ${tu.name}` }
        }
      } catch (e) {
        result = { error: `tool ${tu.name} threw: ${e.message}` }
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 20000)
      })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })

    if (aborted) break
  }

  // Rescue turn: if the loop exited with no edits AND no abort, Claude either
  // ended with a text-only plan (describe-instead-of-execute) or burned its
  // iterations on repeated reads without committing to an edit. Either way a
  // one-shot nudge is worth one more LLM call. This rescue runs even if
  // iterations == MAX_ITERATIONS — the cap is for the main loop, the rescue
  // is a deliberate one-extra-turn escape hatch.
  if (!aborted && edits.length === 0) {
    iterations++
    const nudge = 'STOP reading and searching. I have zero proposed edits staged and no abort was called. Your next turn must contain ONLY tool calls: propose_edit for each file you want to change (one per file), OR abort with a specific reason if you cannot proceed. Do NOT narrate, plan, or say "let me". Just call the tools.'
    messages.push({ role: 'user', content: nudge })
    const retry = await claudeClient.messages.create({
      model,
      max_tokens: maxTokens,
      tools: TOOLS,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages
    })
    const u = retry.usage || {}
    totalUsage.input_tokens += u.input_tokens || 0
    totalUsage.output_tokens += u.output_tokens || 0
    totalUsage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0
    totalUsage.cache_read_input_tokens += u.cache_read_input_tokens || 0

    const retryText = (retry.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    if (retryText) finalText = retryText
    const retryTools = (retry.content || []).filter(b => b.type === 'tool_use')
    for (const tu of retryTools) {
      if (tu.name === 'propose_edit') {
        const { path, new_content, reason } = tu.input || {}
        if (path && typeof new_content === 'string') {
          let original = null
          try { const r = await ghAccess.readFile(path); original = r.content } catch (_) { /* new file */ }
          const { content: normalized, noop } = normalizeEdit(original, new_content)
          if (!noop) edits.push({ path, new_content: normalized, reason: reason || '' })
        }
      } else if (tu.name === 'abort') {
        aborted = true
        abortReason = (tu.input && tu.input.reason) || 'unspecified'
      }
    }
  }

  return { edits, aborted, abortReason, finalText, iterations, usage: totalUsage }
}

module.exports = { runFixLoop, TOOLS, MAX_ITERATIONS }
