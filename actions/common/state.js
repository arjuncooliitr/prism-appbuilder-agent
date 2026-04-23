/**
 * Shared state-store helpers for Prism.
 *
 * Uses @adobe/aio-lib-state for issue/PR tracking.
 *
 * Constraints we have to respect:
 *   - keys must match /^[a-zA-Z0-9-_.*]{1,1024}$/ → we normalize "owner/repo"
 *     by replacing disallowed chars with '-' and use '.' as the separator.
 *   - values must be strings → we JSON.stringify on put and JSON.parse on get.
 *
 * Key shape:
 *   issue.<owner-repo>.<number>
 *   pr.<owner-repo>.<number>
 */

const { State } = require('@adobe/aio-sdk')

let cached = null

async function getState () {
  if (!cached) {
    cached = await State.init()
  }
  return cached
}

/** Replace any char not in [a-zA-Z0-9-_.] with '-' so the key passes validation. */
function normalize (s) {
  return String(s).replace(/[^a-zA-Z0-9-_.]/g, '-')
}

function issueKey (repo, number) {
  return `issue.${normalize(repo)}.${number}`
}

function prKey (repo, number) {
  return `pr.${normalize(repo)}.${number}`
}

/** Safely parse a stored value (which we always JSON-encode on write). */
function decode (raw) {
  if (raw == null) return null
  if (typeof raw !== 'string') return raw  // tolerate legacy shape
  try {
    return JSON.parse(raw)
  } catch (_) {
    return raw
  }
}

async function getIssue (repo, number) {
  const s = await getState()
  const res = await s.get(issueKey(repo, number))
  return res ? decode(res.value) : null
}

async function putIssue (repo, number, value, ttl = 86400 * 30) {
  const s = await getState()
  await s.put(issueKey(repo, number), JSON.stringify(value), { ttl })
}

async function listIssues () {
  const s = await getState()
  const out = []
  for await (const { keys } of s.list({ match: 'issue.*' })) {
    for (const key of keys) {
      const res = await s.get(key)
      if (res && res.value) {
        const decoded = decode(res.value)
        if (decoded) out.push(decoded)
      }
    }
  }
  return out
}

/** Settings accessors. Keys are stored as `setting.<name>`. */
async function getSetting (name, defaultValue = null) {
  const s = await getState()
  const res = await s.get(`setting.${name}`)
  if (!res) return defaultValue
  const decoded = decode(res.value)
  return decoded == null ? defaultValue : decoded
}

async function setSetting (name, value, ttl = 86400 * 365) {
  const s = await getState()
  await s.put(`setting.${name}`, JSON.stringify(value), { ttl })
}

async function deleteIssuesByRepo (repo) {
  const s = await getState()
  const prefix = `issue.${normalize(repo)}.`
  let deleted = 0
  for await (const { keys } of s.list({ match: `${prefix}*` })) {
    for (const key of keys) {
      await s.delete(key)
      deleted++
    }
  }
  return deleted
}

module.exports = {
  getState,
  issueKey,
  prKey,
  normalize,
  getIssue,
  putIssue,
  listIssues,
  getSetting,
  setSetting,
  deleteIssuesByRepo
}
