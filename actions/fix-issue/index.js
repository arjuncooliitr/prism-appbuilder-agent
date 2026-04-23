/**
 * fix-issue action — v3
 *
 * Routing by archetype:
 *   needs-human  → skip immediately, mark with reason
 *   dep-bump     → stub (real implementation is Day-3 scope)
 *   typo         → deterministic regex-extract find-and-replace first;
 *                  fall through to Claude tool-use loop if that can't find a
 *                  clean (old, new) pair or no files match
 *   bug          → Claude tool-use loop (archetype-specific system prompt)
 *
 * The deterministic path was added after issue #32 (a simple URL replacement)
 * repeatedly trapped the Claude loop in a describe-then-don't-execute failure
 * mode. For tasks that have a clean mechanical solution, a small regex +
 * grep-rewrite helper is strictly better than an agent.
 *
 * After edits are staged (via either path), this action inline-chains the
 * create-pr helper so one invocation drives the full workflow. CloudFront's
 * 60s sync limit will 504 the caller, but state ends up fully populated and
 * the Dashboard's poll loop picks up the result.
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { octokit, parseRepo, getDefaultBranch, getRepoTree, getFileContent } = require('../common/github')
const { client: claudeClient, DEFAULT_MODEL } = require('../common/claude')
const { runFixLoop } = require('../common/claude-tools')
const { renderAll } = require('../common/diff')
const { createPRFromDraft } = require('../common/pr')
const { tryDeterministicTypoFix } = require('../common/deterministic-fix')
const { tryDeterministicDepBump } = require('../common/dep-bump')
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
2. Otherwise, use search_content with the exact broken string from the issue to locate where it actually lives. Narrow with path_filter (".md", "docs/") when the issue is obviously about docs.
3. Once located, read_file the candidate, verify the typo/mistake actually exists, then propose_edit with the FULL NEW CONTENT of the file.
4. Keep the change minimal — fix the typo and nothing else.

Abort criteria (with specific reasons, not "no edits"):
- If search_content returns zero matches after reasonable path filters, abort "could not locate <query>".
- If the fix would span > 3 files, abort "fix spans too many files".
- If the issue is actually a feature request / unclear / ambiguous, abort with a clear reason.
- NEVER end the loop without either proposing an edit or calling abort.

CRITICAL execution discipline:
- After search_content returns matches, you have everything you need. Read each matched file ONCE, then in the VERY NEXT turn call propose_edit for each. Do not search again. Do not read any file twice.
- Budget: 1 search_content + up to 3 read_file + up to 3 propose_edit. More than that, something is wrong — abort.
- Text in your response is ignored by the runtime. Tool calls are the only thing that matters.

Rules:
- Preserve trailing newline, indentation, and existing formatting exactly.
- Only propose edits to files whose problem you directly verified by reading.`

const SYSTEM_PROMPT_BUG = `You are Prism, an autonomous engineer fixing bug issues in Adobe's aio open-source repos.

You have five tools:
- list_files(pattern?): discover files in the repo by PATH match.
- search_content(query, path_filter?): grep file CONTENTS across the repo.
- read_file(path): read a file's full contents.
- propose_edit(path, new_content, reason): stage the replacement content for a file.
- abort(reason): cleanly abandon with a specific reason.

Workflow:
1. Read the issue title, body, and suggested fix carefully. Many aio bug reports include the exact fix in the body.
2. If the fix is NOT specified and requires understanding of the codebase, abort "fix requires investigation beyond what's specified".
3. If the fix IS specified: search / list / read to locate the file, verify the current code matches what the issue describes, then propose_edit.
4. If the change would span > 3 files, or tests would be essential to verify, abort with a specific reason.

Abort criteria (with specific reasons, not "no edits"):
- If you can't locate the relevant code, abort "could not locate <what>".
- If the issue's fix is ambiguous, abort "fix unclear: <what's missing>".
- NEVER end the loop without either proposing an edit or calling abort.

Rules:
- NEVER guess at a fix. If the issue doesn't give you a concrete change, abort.
- Preserve formatting, imports, and unrelated code exactly.`

function pickSystemPrompt (archetype) {
  if (archetype === 'typo') return SYSTEM_PROMPT_TYPO
  if (archetype === 'bug') return SYSTEM_PROMPT_BUG
  return null
}

/**
 * Build a draft object from a set of proposed edits, enriching with before-
 * content and a unified diff. Shared by the deterministic and Claude paths.
 */
async function buildDraft ({ issue, edits, ghAccess, summary, extraMeta = {}, model }) {
  const enriched = []
  for (const e of edits) {
    let beforeContent = ''
    try { beforeContent = (await ghAccess.readFile(e.path)).content } catch (_) { /* new file */ }
    enriched.push({ path: e.path, afterContent: e.new_content, beforeContent, reason: e.reason })
  }
  const diffText = renderAll(enriched)
  const method = extraMeta.method || 'claude'
  const methodLabel = method === 'deterministic' ? 'deterministic find-and-replace' : `Claude tool-use loop (${model})`

  return {
    branch: `prism/fix-${issue.number}`,
    title: `[Prism] ${issue.title}`,
    summary: summary || `Fix for ${issue.repo}#${issue.number}`,
    files_changed: enriched.map(e => ({ path: e.path, reason: e.reason })),
    edits: enriched.map(e => ({ path: e.path, content: e.afterContent })),
    diff: diffText,
    body: [
      `## Prism autonomous fix for #${issue.number}`,
      '',
      `**Archetype:** ${issue.triage.archetype}`,
      `**Priority:** P${issue.triage.priority}`,
      `**Method:** ${methodLabel}`,
      '',
      summary || '',
      '',
      '### Files changed',
      ...enriched.map(e => `- \`${e.path}\` — ${e.reason || ''}`),
      '',
      `> Generated by Prism. Awaiting human review.`
    ].join('\n'),
    generated_at: new Date().toISOString(),
    method,
    ...extraMeta
  }
}

/**
 * Persist the draft to state, then inline-chain create-pr so a single
 * invocation drives the full pipeline. 504-tolerant: state is written
 * regardless of whether the client is still connected.
 */
async function stageAndOpenPR ({ issue, draft, githubToken, logger, repoKey, number }) {
  const staged = { ...issue, status: 'pr-drafted', draft }
  await putIssue(repoKey, number, staged)

  try {
    logger.info(`Chaining PR creation for ${repoKey}#${number}`)
    const prResult = await createPRFromDraft({ githubToken, issue: staged, logger })
    const final = { ...staged, status: prResult.status, pr: prResult.pr }
    await putIssue(repoKey, number, final)
    return { draft, pr: prResult.pr, note: prResult.note }
  } catch (prErr) {
    logger.error(`PR creation failed after draft was staged: ${prErr.message}`)
    const final = { ...staged, pr_error: prErr.message }
    await putIssue(repoKey, number, final)
    return { draft, pr_error: prErr.message, note: 'Draft staged but PR creation failed — use the create-pr action to retry.' }
  }
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

    // needs-human: short-circuit
    if (archetype === 'needs-human') {
      const updated = { ...issue, status: 'skipped', skip_reason: 'needs-human triage' }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), status: 'skipped', reason: 'needs-human' } }
    }

    // dep-bump: deterministic path (real). Handled below after we set up
    // ghAccess so the same GitHub context is reused.

    // GitHub client + repo tree (needed by both deterministic and Claude paths)
    const githubToken = params.GITHUB_TOKEN
    if (!githubToken) return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)
    const gh = octokit(githubToken)
    const { owner, repo: repoName } = parseRepo(repo)
    const defaultBranch = await getDefaultBranch(gh, owner, repoName)
    const tree = await getRepoTree(gh, owner, repoName, defaultBranch)
    if (tree.truncated) logger.warn(`Repo tree truncated for ${repo}; may miss files`)
    const allPaths = tree.files.map(f => f.path)

    const readCache = new Map()
    const ghAccess = {
      owner, repo: repoName,
      async listAll () { return allPaths.slice() },
      async readFile (path) {
        if (readCache.has(path)) return readCache.get(path)
        const res = await getFileContent(gh, owner, repoName, path, defaultBranch)
        readCache.set(path, res)
        return res
      }
    }

    // ─── Deterministic typo path: try first, fall through to Claude if it bails ───
    if (archetype === 'typo') {
      const det = await tryDeterministicTypoFix({ issue, ghAccess, logger })
      if (det && det.edits.length > 0) {
        const draft = await buildDraft({
          issue,
          edits: det.edits,
          ghAccess,
          summary: det.summary,
          extraMeta: {
            method: 'deterministic',
            deterministic: { pair: det.pair, source: det.pair.source }
          },
          model: null
        })
        const result = await stageAndOpenPR({ issue, draft, githubToken, logger, repoKey: repo, number: Number(number) })
        return { statusCode: 200, body: { repo, number: Number(number), method: 'deterministic', ...result } }
      }
      logger.info(`Deterministic typo path did not produce edits for ${repo}#${number}; falling through to Claude loop`)
    }

    // ─── Deterministic dep-bump path: extract intents, query npm, rewrite package.json ───
    if (archetype === 'dep-bump') {
      const det = await tryDeterministicDepBump({ issue, ghAccess, logger })
      if (det && det.edits.length > 0) {
        const draft = await buildDraft({
          issue,
          edits: det.edits,
          ghAccess,
          summary: det.summary,
          extraMeta: {
            method: 'deterministic-dep-bump',
            deterministic: { bumps: det.bumps }
          },
          model: null
        })
        // Append a note about package-lock.json to the PR body since the
        // lock will be stale after a raw package.json bump.
        draft.body += '\n\n> Note: `package.json` updated only — `package-lock.json` / `npm-shrinkwrap.json` may need regeneration (`npm install --package-lock-only`). Reviewer, please regenerate before merge.'
        const result = await stageAndOpenPR({ issue, draft, githubToken, logger, repoKey: repo, number: Number(number) })
        return { statusCode: 200, body: { repo, number: Number(number), method: 'deterministic-dep-bump', ...result } }
      }
      // If no bumps extractable, mark skipped — don't hand dep-bumps to the Claude
      // tool-use loop because the bug/typo prompts don't fit this archetype.
      const reason = 'dep-bump: could not extract a package + target version from the issue body'
      const updated = { ...issue, status: 'skipped', skip_reason: reason, last_attempt: new Date().toISOString() }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), status: 'skipped', reason } }
    }

    // ─── Claude tool-use loop (typo-fallback + bug) ───
    const systemPrompt = pickSystemPrompt(archetype)
    if (!systemPrompt) {
      return errorResponse(400, `Unsupported archetype for auto-fix: ${archetype}`, logger)
    }

    const bearerToken = params.AWS_BEARER_TOKEN_BEDROCK
    const awsAccessKey = params.AWS_ACCESS_KEY_ID
    const awsSecretKey = params.AWS_SECRET_ACCESS_KEY
    const awsRegion = params.AWS_REGION || 'us-east-1'
    const model = params.BEDROCK_MODEL_ID || DEFAULT_MODEL
    const claude = claudeClient({ bearerToken, awsAccessKey, awsSecretKey, awsRegion })
    if (!claude) return errorResponse(500, 'Claude/Bedrock client could not be created — check AWS_BEARER_TOKEN_BEDROCK', logger)

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
      'Fix this issue. Use the tools. When done, call propose_edit for each file you want to change.'
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
          repo, number: Number(number),
          status: 'skipped', reason,
          iterations: result.iterations,
          usage: result.usage,
          final_text: result.finalText
        }
      }
    }

    const draft = await buildDraft({
      issue,
      edits: result.edits,
      ghAccess,
      summary: result.finalText,
      extraMeta: { iterations: result.iterations, usage: result.usage, method: 'claude' },
      model
    })
    const openResult = await stageAndOpenPR({ issue, draft, githubToken, logger, repoKey: repo, number: Number(number) })
    return { statusCode: 200, body: { repo, number: Number(number), method: 'claude', ...openResult } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `fix-issue error: ${error.message}`, logger)
  }
}

exports.main = main
