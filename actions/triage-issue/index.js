/**
 * triage-issue action (v2 — 3-level priority scheme)
 *
 * Takes a single issue (repo + number) and classifies it via Claude:
 *   - priority:   1 (critical) .. 5 (nice-to-have)
 *   - freshness:  fresh | active | stale
 *   - archetype:  typo | dep-bump | bug | needs-human
 *   - rationale:  one-line explanation for the dashboard
 *
 * Day 1: falls back to a heuristic stub when ANTHROPIC_API_KEY is absent so
 * the dashboard has data to render end-to-end.
 */

const { Core } = require('@adobe/aio-sdk')
const { getIssue, putIssue } = require('../common/state')
const { client, jsonCompletion, DEFAULT_MODEL } = require('../common/claude')
const { errorResponse, stringParameters } = require('../utils')

const SYSTEM_PROMPT = `You are PRism, a triage assistant for open-source GitHub issues in Adobe's App Builder (aio) ecosystem.

For each issue you receive, return STRICT JSON with this shape:
{
  "priority": 1 | 2 | 3,    // 1 = high (must fix soon), 2 = medium (should fix), 3 = low (nice-to-have)
  "freshness": "fresh|active|stale",  // fresh<7d, active 7-30d, stale >30d with no recent activity
  "archetype": "typo|dep-bump|bug|needs-human",
  "rationale": "one short sentence explaining the above, max 160 chars"
}

Priority guidance:
- P1 (high): reproducible user-blocking bugs, broken CI, security issues, regressions, or anything labelled critical/p0/p1.
- P2 (medium): confirmed bugs without severe impact, dep bumps with CVEs, docs issues that mislead users.
- P3 (low): typos, cosmetic tweaks, minor improvements, stale feature requests.

Archetype guidance:
- "typo" covers documentation/README/markdown fixes, broken links, and small copy edits.
- "dep-bump" covers stale dependency versions in package.json that can be safely bumped.
- "bug" covers reproducible defects with clear scope that a small code change can fix.
- "needs-human" is for feature requests, architectural changes, vague reports, or anything ambiguous. When in doubt, lean here.

Labels like "help wanted", "good first issue", "docs", "critical", "p0" are strong signals.
Respond with ONLY the JSON object. No preamble, no code fences.`

function daysBetween (a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24)
}

/**
 * Heuristic stub used when the LLM is not available.
 */
function heuristicTriage (issue) {
  const labels = (issue.labels || []).map(l => (l || '').toLowerCase())
  const now = new Date().toISOString()
  const ageDays = daysBetween(now, issue.created_at)
  const staleness = daysBetween(now, issue.updated_at)

  let archetype = 'needs-human'
  if (labels.includes('documentation') || labels.includes('docs') || /typo|spelling|readme/i.test(issue.title)) {
    archetype = 'typo'
  } else if (/dependency|dep-bump|bump|upgrade/i.test(issue.title) || labels.includes('dependencies')) {
    archetype = 'dep-bump'
  } else if (labels.includes('bug')) {
    archetype = 'bug'
  }

  // 3-level priority: 1 high / 2 medium / 3 low
  let priority = 2
  if (labels.includes('critical') || labels.includes('p0')
      || labels.includes('high') || labels.includes('p1')
      || labels.includes('security')) {
    priority = 1
  } else if (archetype === 'bug' && !labels.includes('low')) {
    priority = 2
  } else if (archetype === 'typo' || archetype === 'needs-human') {
    priority = 3
  }

  let freshness = 'active'
  if (ageDays < 7) freshness = 'fresh'
  else if (staleness > 30) freshness = 'stale'

  return {
    priority,
    freshness,
    archetype,
    rationale: `[heuristic] ${archetype} archetype inferred from labels/title; age ${Math.round(ageDays)}d, updated ${Math.round(staleness)}d ago.`
  }
}

async function llmTriage (c, issue, model) {
  const payload = JSON.stringify({
    repo: issue.repo,
    title: issue.title,
    body: (issue.body || '').slice(0, 3000),
    labels: issue.labels,
    comments: issue.comments,
    created_at: issue.created_at,
    updated_at: issue.updated_at
  })
  const { data, raw, usage, parseError } = await jsonCompletion(c, {
    system: SYSTEM_PROMPT,
    user: payload,
    model: model || DEFAULT_MODEL
  })
  if (!data) {
    throw new Error(`Claude returned unparseable JSON: ${parseError || 'unknown'} — raw: ${raw}`)
  }
  return { ...data, rationale: data.rationale || '', _usage: usage }
}

async function main (params) {
  const logger = Core.Logger('triage-issue', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.debug(stringParameters(params))

    const { repo, number } = params
    if (!repo || !number) {
      return errorResponse(400, 'repo and number are required', logger)
    }

    const issue = await getIssue(repo, Number(number))
    if (!issue) {
      return errorResponse(404, `Issue ${repo}#${number} not found in state — run fetch-issues first`, logger)
    }

    const apiKey = params.ANTHROPIC_API_KEY
    const model = params.ANTHROPIC_MODEL || DEFAULT_MODEL
    const c = client(apiKey)

    // Diagnostics surfaced in the response so we can trace LLM-vs-heuristic path
    const diag = {
      has_api_key: Boolean(apiKey),
      api_key_len: apiKey ? apiKey.length : 0,
      api_key_prefix: apiKey ? apiKey.slice(0, 7) : null,
      sdk_loaded: c !== null || Boolean(apiKey), // true if ctor path was attempted
      client_created: c !== null,
      model
    }

    let triage
    let lastError = null
    if (c) {
      logger.info(`Triaging ${repo}#${number} with ${model}`)
      try {
        triage = await llmTriage(c, issue, model)
        diag.path = 'llm'
      } catch (e) {
        logger.error(`LLM triage failed, falling back to heuristic: ${e.message}`)
        lastError = e.message
        triage = heuristicTriage(issue)
        diag.path = 'llm-failed-fallback'
      }
    } else {
      logger.warn(`client() returned null — heuristic for ${repo}#${number}`)
      triage = heuristicTriage(issue)
      diag.path = 'heuristic'
    }
    if (lastError) triage.llm_error = lastError

    const updated = {
      ...issue,
      status: 'triaged',
      triage: { ...triage, at: new Date().toISOString() }
    }
    await putIssue(repo, Number(number), updated)

    return { statusCode: 200, body: { repo, number: Number(number), triage, _diag: diag } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, `triage-issue error: ${error.message}`, logger)
  }
}

exports.main = main
