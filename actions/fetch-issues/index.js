/**
 * fetch-issues action
 *
 * Pulls open issues from every repo listed in TARGET_REPOS (CSV of "owner/repo"
 * entries), merges them with any existing state, and returns the combined
 * dashboard payload.
 *
 * GET/POST params:
 *   - force (optional): if "true", re-fetches even if we polled recently
 */

const { Core } = require('@adobe/aio-sdk')
const { octokit, parseTargetRepos, listOpenIssues } = require('../common/github')
const { getIssue, putIssue, listIssues } = require('../common/state')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('fetch-issues', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const token = params.GITHUB_TOKEN
    const repos = parseTargetRepos(params.TARGET_REPOS)

    if (!token) {
      return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)
    }
    if (repos.length === 0) {
      return errorResponse(400, 'TARGET_REPOS is not configured (expected CSV of "owner/repo")', logger)
    }

    const gh = octokit(token)
    const fetched = []
    const errors = []

    for (const { owner, repo } of repos) {
      try {
        const issues = await listOpenIssues(gh, owner, repo, { perPage: 30 })
        logger.info(`Fetched ${issues.length} open issues from ${owner}/${repo}`)

        for (const iss of issues) {
          const existing = await getIssue(iss.repo, iss.number)
          // Merge strategy: start from any prior bot state (draft, pr, triage,
          // skip_reason, approved_at, rejected_at, ...), overlay with fresh
          // GitHub metadata (title, body, labels, comments, updated_at, ...),
          // then explicitly set our timestamps. GitHub data has no `status`
          // field so the existing bot status survives the overlay.
          const merged = {
            ...(existing || {}),
            ...iss,
            status: (existing && existing.status) || 'new',
            first_seen_at: (existing && existing.first_seen_at) || new Date().toISOString(),
            last_fetched_at: new Date().toISOString()
          }
          await putIssue(iss.repo, iss.number, merged)
          fetched.push(merged)
        }
      } catch (e) {
        logger.error(`Failed to fetch ${owner}/${repo}:`, e.message)
        errors.push({ repo: `${owner}/${repo}`, error: e.message })
      }
    }

    // Return the union of everything in state so the dashboard has a consistent view
    const all = await listIssues()

    return {
      statusCode: 200,
      body: {
        count: all.length,
        fetched_now: fetched.length,
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
