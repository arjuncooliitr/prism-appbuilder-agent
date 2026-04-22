/**
 * create-pr action
 *
 * Standalone entry point for pushing a staged draft as a real branch + draft PR.
 * fix-issue already chains this internally; this action is for manual retries
 * (e.g. when the initial GitHub call failed and `issue.pr_error` is set).
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { createPRFromDraft } = require('../common/pr')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('create-pr', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number } = params
    if (!repo || !number) return errorResponse(400, 'repo and number are required', logger)

    const issue = await getIssue(repo, Number(number))
    if (!issue || !issue.draft) return errorResponse(400, `Issue ${repo}#${number} has no draft to PR`, logger)

    const githubToken = params.GITHUB_TOKEN
    if (!githubToken) return errorResponse(400, 'GITHUB_TOKEN is not configured', logger)

    const prResult = await createPRFromDraft({ githubToken, issue, logger })
    const updated = { ...issue, status: prResult.status, pr: prResult.pr, pr_error: null }
    await putIssue(repo, Number(number), updated)

    return { statusCode: 200, body: { repo, number: Number(number), pr: prResult.pr, note: prResult.note } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `create-pr error: ${error.message}${error.status ? ` (status ${error.status})` : ''}`, logger)
  }
}

exports.main = main
