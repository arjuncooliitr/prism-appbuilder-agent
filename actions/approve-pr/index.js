/**
 * approve-pr action — v2, real GitHub call.
 *
 * Approve  → flip draft PR → ready-for-review via GraphQL mutation
 * Reject   → close the PR (if one exists) and mark issue state rejected
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { octokit, parseRepo, markPRReady } = require('../common/github')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('approve-pr', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number, decision = 'approve' } = params
    if (!repo || !number) return errorResponse(400, 'repo and number are required', logger)

    const issue = await getIssue(repo, Number(number))
    if (!issue) return errorResponse(404, `Issue ${repo}#${number} not found`, logger)

    const githubToken = params.GITHUB_TOKEN
    const gh = githubToken ? octokit(githubToken) : null
    const { owner, repo: repoName } = parseRepo(repo)

    if (decision === 'reject') {
      // If there's a real PR, close it
      if (gh && issue.pr && issue.pr.number) {
        try {
          await gh.pulls.update({ owner, repo: repoName, pull_number: issue.pr.number, state: 'closed' })
          logger.info(`Closed PR ${repo}#${issue.pr.number}`)
        } catch (e) {
          logger.warn(`Could not close PR: ${e.message}`)
        }
      }
      const updated = {
        ...issue,
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        pr: issue.pr ? { ...issue.pr, state: 'closed' } : null
      }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), status: 'rejected' } }
    }

    // Approve
    if (!issue.pr || !issue.pr.number) {
      // Stub PR or no PR — just transition state
      const updated = {
        ...issue,
        status: 'approved',
        pr: { ...(issue.pr || {}), state: 'ready-for-review', approved_at: new Date().toISOString() }
      }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), status: 'approved', note: 'no real PR to flip' } }
    }

    if (!gh) return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)

    const flipped = await markPRReady(gh, owner, repoName, issue.pr.number)
    logger.info(`Flipped PR ${repo}#${issue.pr.number} to ready-for-review`)

    const updated = {
      ...issue,
      status: 'approved',
      pr: { ...issue.pr, state: 'ready-for-review', approved_at: new Date().toISOString(), is_draft: flipped.isDraft }
    }
    await putIssue(repo, Number(number), updated)
    return { statusCode: 200, body: { repo, number: Number(number), status: 'approved', pr_url: issue.pr.url } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `approve-pr error: ${error.message}${error.status ? ` (status ${error.status})` : ''}`, logger)
  }
}

exports.main = main
