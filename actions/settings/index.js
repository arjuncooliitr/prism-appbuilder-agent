/**
 * settings action
 *
 * Dashboard-driven configuration management. Currently scoped to the
 * target-repos list. Backed by `settings.target_repos` in aio-lib-state.
 *
 * Operations (via POST body):
 *   { op: 'get' }
 *     → { target_repos: [...], source: 'state' | 'env' }
 *
 *   { op: 'add_repo', repo: 'owner/name' }
 *     → adds the repo to the watched list (idempotent), returns new list
 *
 *   { op: 'remove_repo', repo: 'owner/name', prune?: boolean }
 *     → removes the repo from the watched list. If prune is true, also
 *       deletes all issue records for that repo from state. Returns new
 *       list and the prune count (if applicable).
 *
 * A repo string must match /^[\w.-]+\/[\w.-]+$/ to keep malformed input
 * out of GitHub API calls down the line.
 */

const { Core } = require('@adobe/aio-sdk')
const { getSetting, setSetting, deleteIssuesByRepo } = require('../common/state')
const { parseTargetRepos } = require('../common/github')
const { errorResponse, stringParameters } = require('../utils')

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

/** Resolve the canonical current list, with env fallback. */
async function currentRepos (params) {
  const stateRepos = await getSetting('target_repos', null)
  if (Array.isArray(stateRepos)) return { list: stateRepos, source: 'state' }
  const parsed = parseTargetRepos(params.TARGET_REPOS || '').map(r => `${r.owner}/${r.repo}`)
  return { list: parsed, source: 'env' }
}

async function main (params) {
  const logger = Core.Logger('settings', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const op = params.op || 'get'
    const { list, source } = await currentRepos(params)

    if (op === 'get') {
      return { statusCode: 200, body: { target_repos: list, source } }
    }

    const repo = params.repo
    if (!repo || !REPO_RE.test(repo)) {
      return errorResponse(400, `repo is required and must match "owner/name"`, logger)
    }

    if (op === 'add_repo') {
      const next = list.includes(repo) ? list.slice() : [...list, repo]
      await setSetting('target_repos', next)
      logger.info(`Added ${repo}; list is now ${next.length} repo(s)`)
      return { statusCode: 200, body: { target_repos: next, source: 'state', added: !list.includes(repo) } }
    }

    if (op === 'remove_repo') {
      const next = list.filter(r => r !== repo)
      await setSetting('target_repos', next)
      let pruned = 0
      if (params.prune === true || params.prune === 'true') {
        pruned = await deleteIssuesByRepo(repo)
        logger.info(`Removed ${repo} and pruned ${pruned} issue record(s) from state`)
      } else {
        logger.info(`Removed ${repo}; state records preserved`)
      }
      return {
        statusCode: 200,
        body: {
          target_repos: next,
          source: 'state',
          removed: list.includes(repo),
          pruned_issues: pruned
        }
      }
    }

    return errorResponse(400, `unknown op: ${op}`, logger)
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `settings error: ${error.message}`, logger)
  }
}

exports.main = main
