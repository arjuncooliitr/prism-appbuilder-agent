/**
 * Shared state-store helpers for PRism.
 *
 * Uses @adobe/aio-lib-state for issue/PR tracking. Keys:
 *   issue:<owner>/<repo>:<number>
 *   pr:<owner>/<repo>:<number>
 *   stats:run:<timestamp>
 */

const { State } = require('@adobe/aio-sdk')

let cached = null

async function getState () {
  if (!cached) {
    cached = await State.init()
  }
  return cached
}

function issueKey (repo, number) {
  return `issue:${repo}:${number}`
}

function prKey (repo, number) {
  return `pr:${repo}:${number}`
}

async function getIssue (repo, number) {
  const s = await getState()
  const res = await s.get(issueKey(repo, number))
  return res ? res.value : null
}

async function putIssue (repo, number, value, ttl = 86400 * 30) {
  const s = await getState()
  await s.put(issueKey(repo, number), value, { ttl })
}

async function listIssues () {
  const s = await getState()
  const out = []
  // aio-lib-state supports listing with a match prefix
  for await (const { keys } of s.list({ match: 'issue:*' })) {
    for (const key of keys) {
      const res = await s.get(key)
      if (res && res.value) out.push(res.value)
    }
  }
  return out
}

module.exports = {
  getState,
  issueKey,
  prKey,
  getIssue,
  putIssue,
  listIssues
}
