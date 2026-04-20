/**
 * notify action
 *
 * Posts a Slack notification on bot state transitions. Silently no-ops when
 * SLACK_WEBHOOK_URL is not configured so Day 1 can run without Slack wired up.
 */

const { Core } = require('@adobe/aio-sdk')
const fetch = require('node-fetch')
const { errorResponse, stringParameters } = require('../utils')

async function main (params) {
  const logger = Core.Logger('notify', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const webhook = params.SLACK_WEBHOOK_URL
    const { event, repo, number, text } = params

    if (!event) {
      return errorResponse(400, 'event is required', logger)
    }

    if (!webhook) {
      logger.info(`SLACK_WEBHOOK_URL not set — would have posted: [${event}] ${repo}#${number} — ${text || ''}`)
      return { statusCode: 200, body: { posted: false, reason: 'no-webhook' } }
    }

    const payload = {
      text: `*PRism* · \`${event}\` · ${repo}#${number}\n${text || ''}`
    }

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      throw new Error(`Slack webhook failed: ${res.status}`)
    }

    return { statusCode: 200, body: { posted: true } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `notify error: ${error.message}`, logger)
  }
}

exports.main = main
