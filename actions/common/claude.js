/**
 * Shared Claude client helpers for PRism.
 *
 * Uses Anthropic's Bedrock-compatible SDK so we can authenticate with AWS
 * instead of an sk-ant key. The API surface (messages.create, system blocks
 * with cache_control, tool use) is identical.
 *
 * Auth priority inside the action:
 *   1. explicit AWS_BEARER_TOKEN_BEDROCK (long-term Bedrock API key)
 *   2. explicit awsAccessKey / awsSecretKey pair
 *   3. (if neither) falls back to heuristic triage at the caller
 */

let BedrockCtor
try {
  // eslint-disable-next-line global-require
  const mod = require('@anthropic-ai/bedrock-sdk')
  BedrockCtor = mod.AnthropicBedrock || mod.default || mod
} catch (_) {
  BedrockCtor = null
}

const DEFAULT_MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0'

/**
 * Returns an AnthropicBedrock client, or null if auth/ctor isn't available.
 * @param {object} opts
 * @param {string} opts.bearerToken   AWS_BEARER_TOKEN_BEDROCK value
 * @param {string} opts.awsAccessKey
 * @param {string} opts.awsSecretKey
 * @param {string} opts.awsRegion
 */
function client ({ bearerToken, awsAccessKey, awsSecretKey, awsRegion }) {
  if (!BedrockCtor) return null
  const region = awsRegion || 'us-east-1'
  try {
    if (bearerToken) {
      return new BedrockCtor({ apiKey: bearerToken, awsRegion: region })
    }
    if (awsAccessKey && awsSecretKey) {
      return new BedrockCtor({ awsAccessKey, awsSecretKey, awsRegion: region })
    }
    return null
  } catch (_) {
    return null
  }
}

/**
 * Call Claude (via Bedrock) for structured JSON output.
 * Uses ephemeral prompt caching on the system prompt block.
 *
 * @param {object} c Bedrock client
 * @param {object} opts
 * @param {string} opts.system system prompt (cacheable)
 * @param {string} opts.user user message (issue payload)
 * @param {string} [opts.model] Bedrock model ID
 * @param {number} [opts.maxTokens]
 */
async function jsonCompletion (c, { system, user, model = DEFAULT_MODEL, maxTokens = 1024 }) {
  const res = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [{ role: 'user', content: user }]
  })
  const text = (res.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return { data: JSON.parse(cleaned), raw: text, usage: res.usage }
  } catch (e) {
    return { data: null, raw: text, usage: res.usage, parseError: e.message }
  }
}

module.exports = {
  DEFAULT_MODEL,
  client,
  jsonCompletion
}
