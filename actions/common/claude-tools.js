/**
 * Claude tool-use loop for PRism's fix-issue action.
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

const MAX_ITERATIONS = 10
const MAX_TREE_FILES = 200
const FILE_SIZE_CAP = 200 * 1024 // 200KB hard cap on files we'll read

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
          case 'propose_edit': {
            const { path, new_content, reason } = tu.input || {}
            if (!path || typeof new_content !== 'string') {
              result = { error: 'path and new_content are required' }
              break
            }
            edits.push({ path, new_content, reason: reason || '' })
            result = { ok: true, staged_edits: edits.length }
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

  return { edits, aborted, abortReason, finalText, iterations, usage: totalUsage }
}

module.exports = { runFixLoop, TOOLS, MAX_ITERATIONS }
