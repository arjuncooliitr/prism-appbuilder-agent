/**
 * create-pr action — STUB for Day 1.
 *
 * Day 2+ will open a real draft PR on GitHub using the content staged by
 * fix-issue. For Day 1 we simulate the transition so the dashboard can walk
 * through the "draft -> awaiting-review" state.
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('create-pr', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number } = params
    if (!repo || !number) {
      return errorResponse(400, 'repo and number are required', logger)
    }

    const issue = await getIssue(repo, Number(number))
    if (!issue || !issue.draft) {
      return errorResponse(400, `Issue ${repo}#${number} has no draft to PR`, logger)
    }

    // Day 1 stub
    const pr = {
      number: null,
      state: 'draft',
      url: `https://github.com/${repo}/pull/pending`,
      title: issue.draft.title,
      created_at: new Date().toISOString()
    }

    const updated = { ...issue, status: 'awaiting-review', pr }
    await putIssue(repo, Number(number), updated)

    return { statusCode: 200, body: { repo, number: Number(number), pr } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `create-pr error: ${error.message}`, logger)
  }
}

exports.main = main
