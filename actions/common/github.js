/**
 * Shared GitHub client helpers for PRism actions.
 */

const { Octokit } = require('@octokit/rest')

/**
 * Build a pre-authed Octokit instance.
 * @param {string} token GitHub PAT with `repo` scope
 * @returns {Octokit}
 */
function octokit (token) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required')
  }
  return new Octokit({
    auth: token,
    userAgent: 'prism-aup-ai-week/0.1.0'
  })
}

/**
 * Parse a comma-separated TARGET_REPOS string into owner/repo tuples.
 * Accepts entries like "adobe/aio-theme" or "adobe/aio-cli-plugin-app-dev".
 * @param {string} csv
 * @returns {Array<{owner: string, repo: string}>}
 */
function parseTargetRepos (csv) {
  if (!csv) return []
  return csv.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const [owner, repo] = pair.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid TARGET_REPOS entry: "${pair}" — expected "owner/repo"`)
    }
    return { owner, repo }
  })
}

/**
 * List open issues (excluding PRs) for a repo.
 * @param {Octokit} client
 * @param {string} owner
 * @param {string} repo
 * @param {object} opts
 * @param {number} [opts.perPage=30]
 */
async function listOpenIssues (client, owner, repo, { perPage = 30 } = {}) {
  const res = await client.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    per_page: perPage,
    sort: 'updated',
    direction: 'desc'
  })
  // GitHub's issues endpoint includes PRs; filter them out
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

module.exports = {
  octokit,
  parseTargetRepos,
  listOpenIssues
}
