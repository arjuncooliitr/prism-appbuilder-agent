/**
 * refix-pr action — iterate on an existing draft PR based on new feedback.
 *
 * Trigger: manual click in the dashboard (today), auto-poll or webhook later.
 *
 * Flow:
 *   1. Load issue + draft + pr from state; bail if no real PR exists.
 *   2. Pull new feedback from GitHub:
 *        - inline review comments (pulls.listReviewComments)
 *        - general PR comments (issues.listComments)
 *        - check runs on the head SHA (checks.listForRef), with ≤2KB of
 *          failure output text per check
 *   3. Filter to feedback newer than the last refix attempt.
 *   4. Run a Claude tool-use loop in "revision" mode. Reads files from the
 *      FIX BRANCH (prism/fix-N), not the default branch — so Claude sees its
 *      own previous edits.
 *   5. Commit the new edits on top of the existing branch (non-force).
 *   6. Post a summary comment on the PR listing what was addressed.
 *   7. Record the attempt in issue.refix_history + bump refix_attempts.
 *
 * Guardrails:
 *   - Hard cap MAX_REFIX_ATTEMPTS = 3 per issue. After that, user must
 *     intervene manually.
 *   - If Claude aborts (ambiguous feedback), we post a clarifying comment on
 *     the PR asking the reviewer for more detail, not a code push.
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const {
  octokit, parseRepo,
  getRepoTree, getFileContent, commitEdits,
  getPR, listReviewComments, listIssueComments, listChecksForRef, postPRComment
} = require('../common/github')
const { client: claudeClient, DEFAULT_MODEL } = require('../common/claude')
const { runFixLoop } = require('../common/claude-tools')
const { renderAll } = require('../common/diff')
const { errorResponse, stringParameters } = require('../utils')

const MAX_REFIX_ATTEMPTS = 3

const SYSTEM_PROMPT_REVISION = `You are Prism, iterating on a PR you already opened, based on new feedback from reviewers or CI.

You will be given:
- The original issue that triggered the fix.
- The diff of your original fix commit(s), so you know what you already changed.
- New feedback since your last iteration: review comments, PR discussion, and failing CI checks with up to 2KB of output per check.

Your tools operate on the FIX BRANCH (prism/fix-N), not the default branch. read_file returns the file as it currently exists on the fix branch, including your previous edits.

## Priority order (strict)

1. **Failing CI checks come FIRST.** If the feedback includes any failing check with compiler, lint, or test errors in its output, fix those before anything else. Lint errors (eol-last, indent, semi, no-trailing-spaces, unused-vars, etc.) are explicit and mechanical — the output tells you the exact file, line, and rule. Apply the fix literally.
2. **Reviewer comments next.** Address the clearest request from a named human reviewer.
3. **Never add proactive "improvements" while CI is red.** If CI is failing, do NOT make spec-compliance suggestions, refactors, or additional field additions. Fix what's broken, let CI go green, then stop. Proactive improvements are out of scope for revision mode entirely.

## Workflow

1. Read the feedback summary carefully. Identify the single highest-priority item per the rules above.
2. Use list_files / read_file to locate the exact line mentioned. read_file gives you the CURRENT state of the fix branch, including your own earlier edits — so you can verify what's already there.
3. propose_edit with the MINIMAL change that resolves the feedback. Do not touch unrelated lines.
4. If the file's current content on the branch already matches what the feedback asks for (i.e. the fix is already applied), call abort with reason "requested change already present on branch". This prevents empty commits.
5. If a reviewer's comment is ambiguous or outside the scope of the original fix, call abort with a reason framed as a question back to the reviewer. Prism posts that as a PR comment instead of pushing code.
6. If CI is failing because of a pre-existing problem unrelated to your fix (infra, disabled repo, cold-start flake), call abort with reason noting that.
7. If nothing in the feedback requires a code change (e.g. all comments are questions or approvals), call abort with reason "no actionable feedback — awaiting more review".

## Formatting rules

- Preserve trailing newlines. If the file ends with '\\n', your new_content MUST also end with '\\n'.
- Preserve indentation style (tabs vs spaces), line endings, and semicolon convention exactly as in the surrounding code.
- Never undo your own previous work unless the feedback explicitly demands it.
- Each iteration is ONE commit; address one concern per iteration unless multiple are trivially related (same file, same rule).`

function summarizeFeedback ({ reviewComments, issueComments, checks, sinceIso }) {
  const lines = []
  const since = sinceIso ? new Date(sinceIso) : null

  // CI failures first — usually the highest-signal
  const failing = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')
  if (failing.length) {
    lines.push('## Failing CI checks (address these FIRST before any other feedback)')
    for (const c of failing) {
      lines.push(`\n### ${c.name} (${c.conclusion})`)
      lines.push(`URL: ${c.html_url}`)
      if (c.output_title) lines.push(`Title: ${c.output_title}`)
      if (c.output_summary) lines.push(`Summary:\n\`\`\`\n${c.output_summary.trim()}\n\`\`\``)
      if (c.output_text) lines.push(`Check output:\n\`\`\`\n${c.output_text.trim()}\n\`\`\``)
      if (c.logs_tail) lines.push(`Job log tail (last 6KB — look here for the actual error):\n\`\`\`\n${c.logs_tail.trim()}\n\`\`\``)
    }
  }

  // New inline review comments
  const newReviewComments = since
    ? reviewComments.filter(c => new Date(c.created_at) > since || new Date(c.updated_at) > since)
    : reviewComments
  if (newReviewComments.length) {
    lines.push('\n## Inline review comments')
    for (const c of newReviewComments) {
      lines.push(`- **@${c.author}** on \`${c.path}\`:${c.line ? ` line ${c.line}` : ''}`)
      lines.push(`  > ${c.body.replace(/\n/g, '\n  > ')}`)
    }
  }

  // New general PR comments (filter out our own Prism-posted summaries)
  const newIssueComments = (since
    ? issueComments.filter(c => new Date(c.created_at) > since)
    : issueComments
  ).filter(c => !(c.body || '').startsWith('🔁 **Prism revision'))
  if (newIssueComments.length) {
    lines.push('\n## PR discussion')
    for (const c of newIssueComments) {
      lines.push(`- **@${c.author}**: ${c.body.split('\n').slice(0, 6).join(' ').slice(0, 500)}`)
    }
  }

  if (lines.length === 0) return null
  return lines.join('\n')
}

function buildCommentBody ({ attempt, summary, filesChanged, commitSha, aborted, abortReason }) {
  if (aborted) {
    return [
      `🤔 **Prism revision (attempt ${attempt}) — no code change**`,
      '',
      abortReason,
      '',
      '> Could you clarify? I\'ll try again once there\'s more detail, or click _Re-fix_ in the dashboard to retry.'
    ].join('\n')
  }
  return [
    `🔁 **Prism revision (attempt ${attempt})**`,
    '',
    summary || 'Pushed an update addressing the feedback above.',
    '',
    filesChanged.length ? '**Files changed:**' : '',
    ...filesChanged.map(f => `- \`${f.path}\`${f.reason ? ` — ${f.reason}` : ''}`),
    '',
    commitSha ? `Commit: \`${commitSha.slice(0, 7)}\`` : '',
    '',
    '> Generated by Prism. Click _Re-fix_ in the dashboard to iterate again.'
  ].filter(Boolean).join('\n')
}

async function main (params) {
  const logger = Core.Logger('refix-pr', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number } = params
    if (!repo || !number) return errorResponse(400, 'repo and number are required', logger)

    const issue = await getIssue(repo, Number(number))
    if (!issue) return errorResponse(404, `Issue ${repo}#${number} not found`, logger)
    if (!issue.pr || !issue.pr.number) {
      return errorResponse(400, `Issue ${repo}#${number} has no real PR to iterate on`, logger)
    }

    // Cap counts only `committed` attempts. No-op and aborted runs don't burn
    // retry quota — otherwise a single confused iteration would exhaust the
    // budget even though no actual fix was pushed.
    const history = issue.refix_history || []
    const committedCount = history.filter(h => h.outcome === 'committed').length
    if (committedCount >= MAX_REFIX_ATTEMPTS) {
      return errorResponse(429, `Refix cap reached (${MAX_REFIX_ATTEMPTS} committed attempts). Human intervention required.`, logger)
    }
    const attempts = history.length

    const githubToken = params.GITHUB_TOKEN
    if (!githubToken) return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)
    const gh = octokit(githubToken)

    const bearerToken = params.AWS_BEARER_TOKEN_BEDROCK
    const awsAccessKey = params.AWS_ACCESS_KEY_ID
    const awsSecretKey = params.AWS_SECRET_ACCESS_KEY
    const awsRegion = params.AWS_REGION || 'us-east-1'
    const model = params.BEDROCK_MODEL_ID || DEFAULT_MODEL
    const claude = claudeClient({ bearerToken, awsAccessKey, awsSecretKey, awsRegion })
    if (!claude) return errorResponse(500, 'Claude/Bedrock client could not be created', logger)

    const { owner, repo: repoName } = parseRepo(repo)
    const prNumber = issue.pr.number
    const pr = await getPR(gh, owner, repoName, prNumber)
    const headRef = pr.head.ref
    const headSha = pr.head.sha

    // Gather feedback
    logger.info(`Fetching feedback for ${repo}#${prNumber} (head ${headSha.slice(0, 7)})`)
    const [reviewComments, issueComments, checks] = await Promise.all([
      listReviewComments(gh, owner, repoName, prNumber),
      listIssueComments(gh, owner, repoName, prNumber),
      listChecksForRef(gh, owner, repoName, headSha)
    ])

    const lastRefixAt = (issue.refix_history || []).slice(-1)[0]?.at
    const sinceIso = lastRefixAt || issue.pr.created_at
    const feedbackSummary = summarizeFeedback({ reviewComments, issueComments, checks, sinceIso })

    if (!feedbackSummary) {
      return {
        statusCode: 200,
        body: {
          repo,
          number: Number(number),
          status: 'no-op',
          reason: 'No new feedback since last iteration.',
          last_checked: new Date().toISOString()
        }
      }
    }

    // Preload tree on the fix branch so Claude reads edits-in-progress, not main
    const tree = await getRepoTree(gh, owner, repoName, headRef)
    if (tree.truncated) logger.warn(`Repo tree truncated for ${repo}@${headRef}`)
    const allPaths = tree.files.map(f => f.path)
    const readCache = new Map()
    const ghAccess = {
      owner, repo: repoName,
      async listAll () { return allPaths.slice() },
      async readFile (path) {
        if (readCache.has(path)) return readCache.get(path)
        const res = await getFileContent(gh, owner, repoName, path, headRef)
        readCache.set(path, res)
        return res
      }
    }

    const userMessage = [
      `Repo: ${repo}`,
      `Working branch: ${headRef} (not ${pr.base.ref})`,
      `Original issue #${issue.number}: ${issue.title}`,
      '',
      '--- Original issue body ---',
      (issue.body || '').slice(0, 1500),
      '--- end body ---',
      '',
      `Your previous fix touched these files:`,
      ...((issue.draft && issue.draft.files_changed) || []).map(f => `- ${f.path}${f.reason ? ` — ${f.reason}` : ''}`),
      '',
      `Attempt ${attempts + 1} of ${MAX_REFIX_ATTEMPTS}.`,
      '',
      '--- NEW FEEDBACK SINCE LAST ATTEMPT ---',
      feedbackSummary,
      '--- end feedback ---',
      '',
      'Iterate. Use the tools to read the current state of the branch and propose_edit minimal changes that address the feedback. If feedback is ambiguous or out of scope, call abort with reason framed as a question to the reviewer.'
    ].join('\n')

    logger.info(`Running revision loop for ${repo}#${prNumber} (attempt ${attempts + 1})`)
    const result = await runFixLoop(claude, ghAccess, {
      model,
      systemPrompt: SYSTEM_PROMPT_REVISION,
      userMessage,
      maxTokens: 4096
    })

    const attemptRecord = {
      at: new Date().toISOString(),
      attempt: attempts + 1,
      trigger: 'manual',
      iterations: result.iterations,
      usage: result.usage,
      // Diagnostics so we can see what Claude was asked to address and how it responded
      feedback_summary: feedbackSummary.slice(0, 4000),
      final_text: (result.finalText || '').slice(0, 2000),
      checks_failing: checks.filter(c => ['failure', 'timed_out', 'action_required'].includes(c.conclusion)).map(c => c.name)
    }

    if (result.aborted) {
      const body = buildCommentBody({
        attempt: attempts + 1,
        aborted: true,
        abortReason: result.abortReason,
        filesChanged: [],
        commitSha: null
      })
      await postPRComment(gh, owner, repoName, prNumber, body)
      attemptRecord.outcome = 'aborted'
      attemptRecord.abort_reason = result.abortReason
      const updated = { ...issue, refix_history: [...(issue.refix_history || []), attemptRecord] }
      await putIssue(repo, Number(number), updated)
      return {
        statusCode: 200,
        body: { repo, number: Number(number), status: 'aborted', reason: result.abortReason, comment_posted: true }
      }
    }

    if (result.edits.length === 0) {
      attemptRecord.outcome = 'no-edits'
      const updated = { ...issue, refix_history: [...(issue.refix_history || []), attemptRecord] }
      await putIssue(repo, Number(number), updated)
      return {
        statusCode: 200,
        body: { repo, number: Number(number), status: 'no-edits', note: 'Claude finished without proposing edits' }
      }
    }

    // Commit to the fix branch (additive commit, not force-push)
    logger.info(`Committing ${result.edits.length} edit(s) to ${headRef}`)
    const commit = await commitEdits(
      gh, owner, repoName, headRef,
      result.edits.map(e => ({ path: e.path, content: e.new_content })),
      `Prism revision (attempt ${attempts + 1}): address PR feedback\n\n${result.finalText || ''}`
    )

    // Build + post a summary comment on the PR
    const filesChanged = result.edits.map(e => ({ path: e.path, reason: e.reason }))
    const body = buildCommentBody({
      attempt: attempts + 1,
      summary: result.finalText,
      filesChanged,
      commitSha: commit.commitSha
    })
    await postPRComment(gh, owner, repoName, prNumber, body)

    // Enrich the draft's diff so the modal can show the latest round
    try {
      const enriched = []
      for (const e of result.edits) {
        let beforeContent = ''
        try { beforeContent = (await ghAccess.readFile(e.path)).content } catch (_) { /* new file */ }
        enriched.push({ path: e.path, afterContent: e.new_content, beforeContent })
      }
      attemptRecord.diff = renderAll(enriched)
    } catch (_) { /* optional */ }

    attemptRecord.outcome = 'committed'
    attemptRecord.commit_sha = commit.commitSha
    attemptRecord.files_changed = filesChanged

    const updated = {
      ...issue,
      refix_history: [...(issue.refix_history || []), attemptRecord],
      pr: { ...issue.pr, last_commit_sha: commit.commitSha, last_updated_at: new Date().toISOString() }
    }
    await putIssue(repo, Number(number), updated)

    return {
      statusCode: 200,
      body: {
        repo,
        number: Number(number),
        status: 'revised',
        attempt: attempts + 1,
        commit_sha: commit.commitSha,
        files_changed: filesChanged,
        usage: result.usage
      }
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `refix-pr error: ${error.message}${error.status ? ` (status ${error.status})` : ''}`, logger)
  }
}

exports.main = main
