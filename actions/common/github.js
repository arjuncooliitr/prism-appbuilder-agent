/**
 * Shared GitHub client helpers for Prism.
 *
 * Read helpers: listing issues, getting repo tree, reading file contents.
 * Write helpers: creating branches, committing edits, opening PRs.
 *
 * All writes go directly to origin (the target repo), so Prism requires push
 * access on every repo in TARGET_REPOS. Branch names are prefixed `prism/`
 * to stay out of the maintainer namespace.
 */

const { Octokit } = require('@octokit/rest')

function octokit (token) {
  if (!token) throw new Error('GITHUB_TOKEN is required')
  return new Octokit({ auth: token, userAgent: 'prism-aup-ai-week/0.2.0' })
}

function parseTargetRepos (csv) {
  if (!csv) return []
  return csv.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const [owner, repo] = pair.split('/')
    if (!owner || !repo) throw new Error(`Invalid TARGET_REPOS entry: "${pair}" — expected "owner/repo"`)
    return { owner, repo }
  })
}

function parseRepo (repoStr) {
  const [owner, repo] = String(repoStr).split('/')
  if (!owner || !repo) throw new Error(`Invalid repo: "${repoStr}"`)
  return { owner, repo }
}

async function listOpenIssues (client, owner, repo, { perPage = 30 } = {}) {
  const res = await client.issues.listForRepo({
    owner, repo, state: 'open', per_page: perPage, sort: 'updated', direction: 'desc'
  })
  return res.data.filter(i => !i.pull_request).map(i => ({
    id: i.id,
    number: i.number,
    title: i.title,
    body: (i.body || '').slice(0, 4000),
    labels: (i.labels || []).map(l => typeof l === 'string' ? l : l.name),
    user: i.user && i.user.login,
    comments: i.comments,
    created_at: i.created_at,
    updated_at: i.updated_at,
    html_url: i.html_url,
    repo: `${owner}/${repo}`
  }))
}

/* ------------ Repo exploration ------------ */

async function getDefaultBranch (client, owner, repo) {
  const res = await client.repos.get({ owner, repo })
  return res.data.default_branch
}

async function getBranchSha (client, owner, repo, branch) {
  const res = await client.git.getRef({ owner, repo, ref: `heads/${branch}` })
  return res.data.object.sha
}

/**
 * Returns a flat list of file paths in the repo at `ref`. Uses the Git Trees
 * API with recursive=1 so we get everything in one call. Large monorepos may
 * return a truncated tree; we flag it so callers can degrade gracefully.
 */
async function getRepoTree (client, owner, repo, ref) {
  const commit = await client.git.getCommit({
    owner, repo,
    commit_sha: await getBranchSha(client, owner, repo, ref)
  })
  const tree = await client.git.getTree({
    owner, repo,
    tree_sha: commit.data.tree.sha,
    recursive: 'true'
  })
  return {
    truncated: tree.data.truncated,
    files: tree.data.tree.filter(t => t.type === 'blob').map(t => ({ path: t.path, size: t.size, sha: t.sha }))
  }
}

/**
 * Read a file's text content at a given ref.
 * Returns { content, sha } where sha is the blob sha (needed for updates).
 */
async function getFileContent (client, owner, repo, path, ref) {
  const res = await client.repos.getContent({ owner, repo, path, ref })
  if (Array.isArray(res.data)) throw new Error(`${path} is a directory, not a file`)
  if (res.data.encoding !== 'base64') throw new Error(`Unexpected encoding: ${res.data.encoding}`)
  const content = Buffer.from(res.data.content, 'base64').toString('utf8')
  return { content, sha: res.data.sha, path: res.data.path }
}

/* ------------ Write path ------------ */

/**
 * Create a new branch `prism/fix-<issueNumber>` pointing at the latest commit
 * on `fromBranch`. Idempotent: deletes + recreates if the branch already exists.
 */
async function createOrResetBranch (client, owner, repo, branchName, fromBranch) {
  const fromSha = await getBranchSha(client, owner, repo, fromBranch)

  // Try to create; if it already exists (422), update it to point at fromSha.
  try {
    await client.git.createRef({
      owner, repo,
      ref: `refs/heads/${branchName}`,
      sha: fromSha
    })
  } catch (e) {
    if (e.status === 422) {
      await client.git.updateRef({
        owner, repo,
        ref: `heads/${branchName}`,
        sha: fromSha,
        force: true
      })
    } else {
      throw e
    }
  }
  return { branch: branchName, baseSha: fromSha }
}

/**
 * Commit one or more file edits to an existing branch in a single commit.
 * Uses the low-level Git Data API (blobs -> tree -> commit -> ref update) so
 * multi-file edits land atomically.
 *
 * @param {Array<{path: string, content: string}>} edits
 * @returns {{commitSha, treeSha, branch}}
 */
async function commitEdits (client, owner, repo, branch, edits, message) {
  if (!edits || edits.length === 0) throw new Error('No edits to commit')
  const branchSha = await getBranchSha(client, owner, repo, branch)
  const baseCommit = await client.git.getCommit({ owner, repo, commit_sha: branchSha })

  // 1. Create a blob per file
  const blobs = await Promise.all(edits.map(e =>
    client.git.createBlob({ owner, repo, content: e.content, encoding: 'utf-8' })
      .then(r => ({ path: e.path, sha: r.data.sha }))
  ))

  // 2. Create a new tree on top of the base tree
  const tree = await client.git.createTree({
    owner, repo,
    base_tree: baseCommit.data.tree.sha,
    tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha }))
  })

  // 3. Create the commit
  const commit = await client.git.createCommit({
    owner, repo,
    message,
    tree: tree.data.sha,
    parents: [branchSha]
  })

  // 4. Move the branch ref to the new commit
  await client.git.updateRef({
    owner, repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
    force: false
  })

  return { commitSha: commit.data.sha, treeSha: tree.data.sha, branch }
}

/**
 * Open a draft PR. Returns the created PR.
 */
async function createDraftPR (client, owner, repo, { title, body, head, base }) {
  const res = await client.pulls.create({
    owner, repo, title, body, head, base, draft: true
  })
  return res.data
}

/**
 * Get a PR's metadata including head SHA and mergeability.
 */
async function getPR (client, owner, repo, prNumber) {
  const res = await client.pulls.get({ owner, repo, pull_number: prNumber })
  return res.data
}

/**
 * List inline review comments on a PR (file + line anchored).
 */
async function listReviewComments (client, owner, repo, prNumber) {
  const res = await client.pulls.listReviewComments({
    owner, repo, pull_number: prNumber, per_page: 50
  })
  return res.data.map(c => ({
    id: c.id,
    author: c.user && c.user.login,
    path: c.path,
    line: c.line || c.original_line,
    body: c.body,
    created_at: c.created_at,
    updated_at: c.updated_at,
    in_reply_to_id: c.in_reply_to_id,
    diff_hunk: c.diff_hunk
  }))
}

/**
 * List general PR discussion comments (PRs are issues under the hood).
 */
async function listIssueComments (client, owner, repo, prNumber) {
  const res = await client.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 50
  })
  return res.data.map(c => ({
    id: c.id,
    author: c.user && c.user.login,
    body: c.body,
    created_at: c.created_at,
    updated_at: c.updated_at
  }))
}

/**
 * Fetch GitHub Actions job logs as plain text. Returns the last `maxBytes`
 * bytes (failures are almost always at the end). GitHub returns a 302 to a
 * signed blob URL; octokit follows the redirect and gives us the text.
 */
async function fetchJobLogs (client, owner, repo, jobId, { maxBytes = 6144 } = {}) {
  try {
    const res = await client.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
      owner, repo, job_id: jobId
    })
    const body = typeof res.data === 'string' ? res.data : String(res.data || '')
    return body.length > maxBytes ? body.slice(body.length - maxBytes) : body
  } catch (_) {
    return null
  }
}

/**
 * List CI check runs for a commit SHA. For failing GitHub Actions workflow
 * checks we also pull the last ~6KB of raw job logs — that's where lint
 * errors, test failures, and compiler output actually live (check.output.text
 * is almost always null for Actions). This is what lets Claude see concrete
 * error messages during refix instead of just a "build failed" URL.
 */
async function listChecksForRef (client, owner, repo, ref, { fetchLogs = true } = {}) {
  const res = await client.checks.listForRef({
    owner, repo, ref, per_page: 50
  })
  const runs = res.data.check_runs || []
  const enriched = await Promise.all(runs.map(async c => {
    const base = {
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      started_at: c.started_at,
      completed_at: c.completed_at,
      html_url: c.html_url,
      app_slug: c.app && c.app.slug,
      output_title: c.output && c.output.title,
      output_summary: c.output && (c.output.summary || '').slice(0, 2048),
      output_text: c.output && (c.output.text || '').slice(0, 2048),
      logs_tail: null
    }
    const isFailure = ['failure', 'timed_out', 'action_required'].includes(c.conclusion)
    if (fetchLogs && isFailure && c.app && c.app.slug === 'github-actions') {
      // html_url format: /actions/runs/{run_id}/job/{job_id}
      const m = (c.html_url || '').match(/\/job\/(\d+)/)
      if (m) {
        base.logs_tail = await fetchJobLogs(client, owner, repo, Number(m[1]))
      }
    }
    return base
  }))
  return enriched
}

/**
 * Post a general comment on a PR (PRs are issues under the hood).
 */
async function postPRComment (client, owner, repo, prNumber, body) {
  const res = await client.issues.createComment({
    owner, repo, issue_number: prNumber, body
  })
  return res.data
}

/**
 * Flip a draft PR to ready-for-review via GraphQL (REST has no direct endpoint).
 */
async function markPRReady (client, owner, repo, prNumber) {
  // Get the PR's node_id via REST first
  const pr = await client.pulls.get({ owner, repo, pull_number: prNumber })
  const nodeId = pr.data.node_id
  const mutation = `
    mutation($id: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $id }) {
        pullRequest { isDraft url }
      }
    }
  `
  const res = await client.graphql(mutation, { id: nodeId })
  return res.markPullRequestReadyForReview.pullRequest
}

module.exports = {
  octokit,
  parseTargetRepos,
  parseRepo,
  listOpenIssues,
  getDefaultBranch,
  getBranchSha,
  getRepoTree,
  getFileContent,
  createOrResetBranch,
  commitEdits,
  createDraftPR,
  markPRReady,
  getPR,
  listReviewComments,
  listIssueComments,
  listChecksForRef,
  postPRComment
}
