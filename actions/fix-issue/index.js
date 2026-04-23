/**
 * fix-issue action — v2, real Claude tool-use loop.
 *
 * Reads repo files via GitHub API, runs Claude with four tools (list_files,
 * read_file, propose_edit, abort), and stages proposed edits into the issue's
 * `draft` field. Doesn't touch GitHub refs or open a PR yet — that's create-pr.
 *
 * Routing by archetype:
 *   typo / bug   → Claude tool-use loop, archetype-specific system prompt
 *   dep-bump     → Day 3 (still stubbed, Claude-authored body but no diff)
 *   needs-human  → skip and mark `skipped`
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { octokit, parseRepo, getDefaultBranch, getRepoTree, getFileContent } = require('../common/github')
const { client: claudeClient, DEFAULT_MODEL } = require('../common/claude')
const { runFixLoop } = require('../common/claude-tools')
const { renderAll } = require('../common/diff')
const { createPRFromDraft } = require('../common/pr')
const { errorResponse, stringParameters } = require('../utils')

const SYSTEM_PROMPT_TYPO = `You are Prism, an autonomous engineer fixing doc-typo / broken-link / tiny-copy issues in Adobe's aio open-source repos.

You have five tools:
- list_files(pattern?): discover files in the repo by PATH (filename) match.
- search_content(query, path_filter?): grep file CONTENTS across the repo. Use this when the issue mentions a specific string (URL, word, phrase) without saying which file contains it.
- read_file(path): read a file's full contents.
- propose_edit(path, new_content, reason): stage the replacement content for a file.
- abort(reason): cleanly abandon with a specific, actionable reason.

Workflow:
1. If the issue names a specific file (e.g. "README.md line 12"), use list_files / read_file directly.
2. Otherwise, use search_content with the exact broken string from the issue (e.g. the old URL, the misspelled word) to locate where it actually lives. Narrow with path_filter (".md", "docs/") when the issue is obviously about docs.
3. Once located, read_file the candidate, verify the typo/mistake actually exists at the reported location, then propose_edit with the FULL NEW CONTENT of the file.
4. Keep the change minimal — fix the typo and nothing else. Don't touch unrelated lines.

Abort criteria (with specific reasons, not "no edits"):
- If search_content returns zero matches AND you've tried reasonable path filters, abort with reason "could not locate <query> in the repo after searching <what you tried>".
- If the fix would span > 3 files, abort with "fix spans too many files".
- If the issue is actually a feature request / unclear / ambiguous, abort with a clear human-readable reason.
- NEVER end the loop without either proposing an edit or calling abort. Silence is not an option — if nothing landed, abort with why.

CRITICAL execution discipline:
- After search_content returns matches, you have everything you need for a typo fix. Read each matched file ONCE with read_file, then in the VERY NEXT turn call propose_edit for each file. Do not search again. Do not read any file twice.
- Budget: 1 search_content + up to 3 read_file + up to 3 propose_edit. If you need more, something is wrong — abort instead.
- Never end a turn with "let me continue" or "let me now" — that wastes an iteration. Just call the next tool directly.
- Text in your response is ignored by the runtime. Tool calls are the only thing that matters. A plan without corresponding tool calls is worse than an abort.

Rules:
- Preserve trailing newline, indentation, and existing formatting exactly.
- Only propose edits to files whose problem you directly verified by reading the file.`

const SYSTEM_PROMPT_BUG = `You are Prism, an autonomous engineer fixing bug issues in Adobe's aio open-source repos.

You have five tools:
- list_files(pattern?): discover files in the repo by PATH match.
- search_content(query, path_filter?): grep file CONTENTS across the repo. Use this to find where a reported symbol, error message, or function lives.
- read_file(path): read a file's full contents.
- propose_edit(path, new_content, reason): stage the replacement content for a file.
- abort(reason): cleanly abandon with a specific, actionable reason.

Workflow:
1. Read the issue title, body, and any suggested fix carefully. Many aio bug reports include the exact fix in the body ("change X to Y", with a code snippet).
2. If the fix is NOT specified in the issue body and requires understanding of the codebase, call abort with reason like "fix requires investigation beyond what's specified in the issue".
3. If the fix IS specified: use search_content (for the specific code snippet or function name mentioned) or list_files to locate the file. Read it. Verify the current code matches what the issue describes. Then propose_edit with the FULL NEW CONTENT.
4. If the change would span > 3 files, or adding tests would be essential to verify, call abort with a specific reason.

Abort criteria (with specific reasons, not "no edits"):
- If you can't locate the relevant code after searching, abort with "could not locate <what you looked for>".
- If the issue's fix is ambiguous, abort with "fix unclear: <what is missing>".
- NEVER end the loop without either proposing an edit or calling abort. Silence is not an option.

Rules:
- NEVER guess at a fix. If the issue body doesn't give you a concrete change, abort.
- Preserve formatting, imports, and unrelated code exactly.
- Only propose edits you can trace directly to the issue description.`

function pickSystemPrompt (archetype) {
  if (archetype === 'typo') return SYSTEM_PROMPT_TYPO
  if (archetype === 'bug') return SYSTEM_PROMPT_BUG
  return null
}

async function main (params) {
  const logger = Core.Logger('fix-issue', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number } = params
    if (!repo || !number) return errorResponse(400, 'repo and number are required', logger)

    const issue = await getIssue(repo, Number(number))
    if (!issue) return errorResponse(404, `Issue ${repo}#${number} not found`, logger)
    if (!issue.triage) return errorResponse(400, `Issue ${repo}#${number} has not been triaged`, logger)

    const archetype = issue.triage.archetype
    if (archetype === 'needs-human') {
      const updated = { ...issue, status: 'skipped', skip_reason: 'needs-human triage' }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), status: 'skipped', reason: 'needs-human' } }
    }

    if (archetype === 'dep-bump') {
      // Day 3 territory. Stub for now but still progress state.
      const stub = {
        branch: `prism/fix-${issue.number}`,
        title: `[Prism] ${issue.title}`,
        body: `Auto-bump proposal (Day 3 stub — dependency bump logic not yet implemented).\n\n> Generated by Prism.`,
        files_changed: [],
        diff: '// dep-bump archetype: real implementation coming Day 3.',
        generated_at: new Date().toISOString(),
        stub: true
      }
      const updated = { ...issue, status: 'pr-drafted', draft: stub }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), draft: stub, note: 'dep-bump stub' } }
    }

    const systemPrompt = pickSystemPrompt(archetype)
    if (!systemPrompt) {
      return errorResponse(400, `Unsupported archetype for auto-fix: ${archetype}`, logger)
    }

    // Build clients
    const bearerToken = params.AWS_BEARER_TOKEN_BEDROCK
    const awsAccessKey = params.AWS_ACCESS_KEY_ID
    const awsSecretKey = params.AWS_SECRET_ACCESS_KEY
    const awsRegion = params.AWS_REGION || 'us-east-1'
    const model = params.BEDROCK_MODEL_ID || DEFAULT_MODEL
    const claude = claudeClient({ bearerToken, awsAccessKey, awsSecretKey, awsRegion })
    if (!claude) return errorResponse(500, 'Claude/Bedrock client could not be created — check AWS_BEARER_TOKEN_BEDROCK', logger)

    const githubToken = params.GITHUB_TOKEN
    if (!githubToken) return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)
    const gh = octokit(githubToken)

    const { owner, repo: repoName } = parseRepo(repo)
    const defaultBranch = await getDefaultBranch(gh, owner, repoName)

    // Pre-fetch the tree once (bounded by the tool's own cap when exposed)
    const tree = await getRepoTree(gh, owner, repoName, defaultBranch)
    if (tree.truncated) logger.warn(`Repo tree truncated for ${repo}; Claude may miss files`)
    const allPaths = tree.files.map(f => f.path)

    // File-content cache, so a repeated read_file doesn't double-bill GitHub
    const readCache = new Map()
    const ghAccess = {
      owner,
      repo: repoName,
      async listAll () { return allPaths.slice() },
      async readFile (path) {
        if (readCache.has(path)) return readCache.get(path)
        const res = await getFileContent(gh, owner, repoName, path, defaultBranch)
        readCache.set(path, res)
        return res
      }
    }

    // Issue context for Claude
    const userMessage = [
      `Repo: ${repo}`,
      `Default branch: ${defaultBranch}`,
      `Issue #${issue.number}: ${issue.title}`,
      `Archetype: ${archetype}`,
      `Labels: ${(issue.labels || []).join(', ') || '(none)'}`,
      '',
      '--- Issue body ---',
      issue.body || '(no body)',
      '--- end body ---',
      '',
      'Fix this issue. Use the tools. When done, call propose_edit for each file you want to change, then emit a short final message describing what you fixed.'
    ].join('\n')

    logger.info(`Running fix loop for ${repo}#${number} (${archetype}) with ${model}`)
    const result = await runFixLoop(claude, ghAccess, { model, systemPrompt, userMessage })

    if (result.aborted || result.edits.length === 0) {
      const reason = result.abortReason || 'no edits proposed'
      const updated = {
        ...issue,
        status: 'skipped',
        skip_reason: reason,
        last_attempt: new Date().toISOString(),
        // Diagnostics so we can trace why the loop produced no edits
        last_attempt_diag: {
          aborted: result.aborted,
          iterations: result.iterations,
          usage: result.usage,
          final_text: (result.finalText || '').slice(0, 2000)
        }
      }
      await putIssue(repo, Number(number), updated)
      return {
        statusCode: 200,
        body: {
          repo,
          number: Number(number),
          status: 'skipped',
          reason,
          iterations: result.iterations,
          usage: result.usage,
          final_text: result.finalText
        }
      }
    }

    // Enrich edits with before-content so the diff renderer can produce unified diffs
    const enriched = []
    for (const e of result.edits) {
      let beforeContent = ''
      try { beforeContent = (await ghAccess.readFile(e.path)).content } catch (_) { /* new file */ }
      enriched.push({ path: e.path, afterContent: e.new_content, beforeContent, reason: e.reason })
    }
    const diffText = renderAll(enriched)

    const draft = {
      branch: `prism/fix-${issue.number}`,
      title: `[Prism] ${issue.title}`,
      summary: result.finalText || `Fix for ${repo}#${issue.number}`,
      files_changed: enriched.map(e => ({ path: e.path, reason: e.reason })),
      edits: enriched.map(e => ({ path: e.path, content: e.afterContent })),
      diff: diffText,
      body: [
        `## Prism autonomous fix for #${issue.number}`,
        '',
        `**Archetype:** ${archetype}`,
        `**Priority:** P${issue.triage.priority}`,
        '',
        result.finalText || '',
        '',
        '### Files changed',
        ...enriched.map(e => `- \`${e.path}\` — ${e.reason || ''}`),
        '',
        `> Generated by Prism (model: ${model}). Awaiting human review before being marked ready.`
      ].join('\n'),
      generated_at: new Date().toISOString(),
      iterations: result.iterations,
      usage: result.usage
    }

    // Persist draft first so even a GitHub failure leaves the user with an
    // inspectable diff in the modal.
    const staged = { ...issue, status: 'pr-drafted', draft }
    await putIssue(repo, Number(number), staged)

    // Now chain the PR creation inline so the whole workflow is one
    // invocation. CloudFront's 60s sync limit will still 504 the caller, but
    // the action keeps running and state ends up fully populated.
    try {
      logger.info(`Chaining PR creation for ${repo}#${number}`)
      const prResult = await createPRFromDraft({ githubToken, issue: staged, logger })
      const final = { ...staged, status: prResult.status, pr: prResult.pr }
      await putIssue(repo, Number(number), final)
      return { statusCode: 200, body: { repo, number: Number(number), draft, pr: prResult.pr } }
    } catch (prErr) {
      logger.error(`PR creation failed after draft was staged: ${prErr.message}`)
      const final = { ...staged, pr_error: prErr.message }
      await putIssue(repo, Number(number), final)
      return {
        statusCode: 200,
        body: {
          repo,
          number: Number(number),
          draft,
          pr_error: prErr.message,
          note: 'Draft staged but PR creation failed — use the create-pr action to retry.'
        }
      }
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `fix-issue error: ${error.message}`, logger)
  }
}

exports.main = main
