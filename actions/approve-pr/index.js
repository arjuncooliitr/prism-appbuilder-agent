/**
 * approve-pr action
 *
 * Dashboard calls this when the human reviewer approves a draft PR.
 * Day 1: updates in-memory state to "approved" (real PR flip happens Day 3+).
 * Day 3: will call GitHub's `markPullRequestReadyForReview` via GraphQL.
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('approve-pr', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number, decision = 'approve' } = params
    if (!repo || !number) {
      return errorResponse(400, 'repo and number are required', logger)
    }

    const issue = await getIssue(repo, Number(number))
    if (!issue) {
      return errorResponse(404, `Issue ${repo}#${number} not found`, logger)
    }

    if (decision === 'reject') {
      const updated = { ...issue, status: 'rejected', rejected_at: new Date().toISOString() }
      await putIssue(repo, Number(number), updated)
      return { statusCode: 200, body: { repo, number: Number(number), status: 'rejected' } }
    }

    // Approve path — Day 1 stub
    const updated = {
      ...issue,
      status: 'approved',
      pr: { ...(issue.pr || {}), state: 'ready-for-review', approved_at: new Date().toISOString() }
    }
    await putIssue(repo, Number(number), updated)

    return { statusCode: 200, body: { repo, number: Number(number), status: 'approved' } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `approve-pr error: ${error.message}`, logger)
  }
}

exports.main = main
