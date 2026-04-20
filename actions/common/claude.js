/**
 * Shared Claude (Anthropic) client helpers for PRism actions.
 *
 * Day 1 note: if ANTHROPIC_API_KEY is not set, helpers return `null` so callers
 * can fall back to mock responses. This lets the rest of the pipeline be
 * developed/demoed before an API key is provisioned.
 */

let AnthropicCtor
try {
  // Lazy-required so the action still works before `npm install` runs.
  // eslint-disable-next-line global-require
  AnthropicCtor = require('@anthropic-ai/sdk')
} catch (_) {
  AnthropicCtor = null
}

const DEFAULT_MODEL = 'claude-opus-4-6'

/**
 * Return an Anthropic client, or null if not configured / SDK not installed.
 * @param {string} apiKey
 * @returns {object|null}
 */
function client (apiKey) {
  if (!apiKey || !AnthropicCtor) return null
  const Anthropic = AnthropicCtor.default || AnthropicCtor
  return new Anthropic({ apiKey })
}

/**
 * Call Claude for structured JSON output. Intended for triage.
 * Uses ephemeral prompt caching on the system prompt block.
 *
 * @param {object} c Anthropic client
 * @param {object} opts
 * @param {string} opts.system system prompt (cacheable)
 * @param {string} opts.user user message (issue payload)
 * @param {string} [opts.model]
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
  // Concatenate text blocks
  const text = (res.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  // Strip ```json fences if the model added them
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
