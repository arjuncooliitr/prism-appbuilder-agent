/**
 * fetch-issues action
 *
 * Pulls open issues from the current target-repo list and merges them with
 * existing state. The target list is read with this precedence:
 *   1. settings.target_repos in aio-lib-state (set via the `settings` action
 *      or the Dashboard's Settings modal)
 *   2. TARGET_REPOS env var (CSV) baked into the action at deploy time
 *
 * Dashboard-managed settings always win so users can add/remove repos from
 * the UI without a redeploy. The env var is used on a fresh install where
 * state has no setting yet.
 *
 * The response includes `target_repos` so the Dashboard can filter out
 * issues from repos that are in state but no longer watched (rather than
 * forcing a destructive prune).
 */

const { Core } = require('@adobe/aio-sdk')
const { octokit, parseTargetRepos, listOpenIssues } = require('../common/github')
const { getIssue, putIssue, listIssues, getSetting } = require('../common/state')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('fetch-issues', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const token = params.GITHUB_TOKEN
    if (!token) return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)

    // Resolve the target list — state-first, env as fallback
    const stateRepos = await getSetting('target_repos', null)
    const repoCsv = Array.isArray(stateRepos) && stateRepos.length > 0
      ? stateRepos.join(',')
      : (params.TARGET_REPOS || '')
    const repos = parseTargetRepos(repoCsv)
    if (repos.length === 0) {
      return errorResponse(400, 'No target repos configured (either settings.target_repos or TARGET_REPOS env)', logger)
    }
    const targetRepos = repos.map(r => `${r.owner}/${r.repo}`)

    const gh = octokit(token)
    const fetched = []
    const updated = []
    const errors = []

    // Fields that, if they've changed, justify a state write. Everything else
    // (last_fetched_at in particular) is write-churn that burns through the
    // aio-lib-state rate limit for zero useful information.
    const GH_FIELDS = ['title', 'body', 'labels', 'user', 'comments', 'created_at', 'updated_at', 'html_url']
    const ghDataChanged = (a, b) => {
      if (!a) return true
      for (const f of GH_FIELDS) {
        if (f === 'labels') {
          const aLabels = (a.labels || []).join('|')
          const bLabels = (b.labels || []).join('|')
          if (aLabels !== bLabels) return true
        } else if (a[f] !== b[f]) {
          return true
        }
      }
      return false
    }

    for (const { owner, repo } of repos) {
      try {
        const issues = await listOpenIssues(gh, owner, repo, { perPage: 30 })
        logger.info(`Fetched ${issues.length} open issues from ${owner}/${repo}`)

        // Parallelize reads — they're the cheap half of the rate budget
        const existingList = await Promise.all(issues.map(iss => getIssue(iss.repo, iss.number)))

        for (let i = 0; i < issues.length; i++) {
          const iss = issues[i]
          const existing = existingList[i]
          const changed = ghDataChanged(existing, iss)

          if (!changed) {
            // No real change — skip the write entirely. This is what fixes the
            // rate-limit stampede: for a quiet poll, we go from 19 writes to 0.
            fetched.push(existing)
            continue
          }

          const merged = {
            ...(existing || {}),
            ...iss,
            status: (existing && existing.status) || 'new',
            first_seen_at: (existing && existing.first_seen_at) || new Date().toISOString(),
            last_fetched_at: new Date().toISOString()
          }
          await putIssue(iss.repo, iss.number, merged)
          fetched.push(merged)
          updated.push(`${iss.repo}#${iss.number}`)
        }

        logger.info(`${owner}/${repo}: ${updated.length} issue(s) written, ${issues.length - updated.length} unchanged`)
      } catch (e) {
        logger.error(`Failed to fetch ${owner}/${repo}:`, e.message)
        errors.push({ repo: `${owner}/${repo}`, error: e.message })
      }
    }

    // Return the union of everything in state so the dashboard has a consistent
    // view. The dashboard filters this list against `target_repos` — issues
    // from repos no longer watched persist in state but don't render.
    const all = await listIssues()

    return {
      statusCode: 200,
      body: {
        count: all.length,
        fetched_now: updated.length,   // only count actual writes — this is what the dashboard activity feed shows
        target_repos: targetRepos,
        settings_source: (stateRepos && stateRepos.length > 0) ? 'state' : 'env',
        errors,
        issues: all
      }
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `fetch-issues error: ${error.message}`, logger)
  }
}

exports.main = main
