/**
 * Deterministic find-and-replace path for typo-archetype issues.
 *
 * Why this exists: the biggest failure of the week was adobe/aio-lib-events#32,
 * where Claude repeatedly failed to commit a simple URL replacement (the tool-
 * use loop thrashed between search / read / narrate without calling
 * propose_edit). The issue was a clean "replace X with Y" task that had no
 * business going through an agent in the first place. This module tries to
 * extract the (old, new) pair via regex heuristics over the issue body; if it
 * can, it greps the repo and rewrites files mechanically. If extraction fails
 * or no files match, it returns null and the caller falls through to the
 * Claude tool-use loop — preserving LLM reasoning for issues that genuinely
 * need it.
 *
 * The design principle is "pick the right tool for the shape of the problem,"
 * which is also the #1 "what I'll change" line in the reflection.
 */

const FILE_SIZE_CAP = 200 * 1024
const MAX_FILES_TO_MODIFY = 10
const MIN_OLD_STRING_LEN = 3

/** Strip trailing slashes / punctuation to normalize URL-like tokens. */
function clean (s) {
  return String(s || '').replace(/[.,;:!?)\]>\/]+$/g, '').trim()
}

/**
 * Extract an (old, new) string pair from a typo-ish issue's title + body using
 * a series of regex heuristics. Returns { old, new, source } or null if no
 * heuristic fires with confidence.
 *
 * Heuristics, tried in order:
 *   1. aio issue template with "Expected Behaviour" and "Actual Behaviour"
 *      sections, each containing a URL — the URL in Actual is the broken one,
 *      the URL in Expected is the correct one (this is what #32 uses).
 *   2. "replace X with Y" / "replace X by Y"
 *   3. "change X to Y"
 *   4. "X should be Y" (conservative — only fires for quoted tokens)
 *   5. Inline code diff: `` `old` → `new` ``
 */
function extractPairFromRegex (title, body) {
  const text = `${title || ''}\n\n${body || ''}`

  // (1) Expected / Actual sections with URLs
  const exp = text.match(/###?\s*Expected\s+Beh?aviou?r\s*\n+([\s\S]*?)(?=\n###|\n\n|$)/i)
  const act = text.match(/###?\s*Actual\s+Beh?aviou?r\s*\n+([\s\S]*?)(?=\n###|\n\n|$)/i)
  if (exp && act) {
    const expUrl = (exp[1].match(/https?:\/\/\S+/) || [])[0]
    const actUrl = (act[1].match(/https?:\/\/\S+/) || [])[0]
    if (expUrl && actUrl) {
      const o = clean(actUrl)
      const n = clean(expUrl)
      if (o !== n && o.length >= MIN_OLD_STRING_LEN) {
        return { old: o, new: n, source: 'expected-actual-urls' }
      }
    }
  }

  // (2) "replace X with Y" or "replace X by Y"
  const m2 = text.match(/replace\s+[`'"]?([^\s`'"]{3,})[`'"]?\s+(?:with|by)\s+[`'"]?([^\s`'"]+)[`'"]?/i)
  if (m2) {
    const o = clean(m2[1])
    const n = clean(m2[2])
    if (o && n && o !== n) return { old: o, new: n, source: 'replace-with' }
  }

  // (3) "change X to Y"
  const m3 = text.match(/change\s+[`'"]?([^\s`'"]{3,})[`'"]?\s+to\s+[`'"]?([^\s`'"]+)[`'"]?/i)
  if (m3) {
    const o = clean(m3[1])
    const n = clean(m3[2])
    if (o && n && o !== n) return { old: o, new: n, source: 'change-to' }
  }

  // (4) Inline code arrow: `foo` → `bar` or `foo` -> `bar`
  const m4 = text.match(/`([^`\n]{3,})`\s*(?:→|-+>|→)\s*`([^`\n]+)`/)
  if (m4) {
    const o = m4[1].trim()
    const n = m4[2].trim()
    if (o && n && o !== n) return { old: o, new: n, source: 'backtick-arrow' }
  }

  // (5) Conservative "X should be Y" (both in code ticks to avoid false matches)
  const m5 = text.match(/`([^`\n]{3,})`\s+should\s+(?:be|read)\s+`([^`\n]+)`/i)
  if (m5) {
    const o = m5[1].trim()
    const n = m5[2].trim()
    if (o && n && o !== n) return { old: o, new: n, source: 'should-be' }
  }

  return null
}

/**
 * Apply a pair-based replacement across the repo.
 * Returns { edits, matchedFiles } where each edit is {path, new_content, reason}.
 */
async function applyReplacement (pair, ghAccess, opts = {}) {
  const maxFiles = opts.maxFiles || MAX_FILES_TO_MODIFY
  const minOldLen = opts.minOldLen || MIN_OLD_STRING_LEN

  if (!pair || !pair.old || pair.old.length < minOldLen) return { edits: [], matchedFiles: [] }
  if (pair.old === pair.new) return { edits: [], matchedFiles: [] }

  const all = await ghAccess.listAll()
  // Skip binary-ish paths
  const candidates = all.filter(p => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|mp4|mov|zip|tar|gz|pdf|svg)$/i.test(p))

  const edits = []
  const matchedFiles = []

  for (const path of candidates) {
    if (matchedFiles.length >= maxFiles) break
    let content
    try { content = (await ghAccess.readFile(path)).content } catch (_) { continue }
    if (!content || content.length > FILE_SIZE_CAP) continue
    if (!content.includes(pair.old)) continue

    const newContent = content.split(pair.old).join(pair.new)
    if (newContent === content) continue

    matchedFiles.push(path)
    const occurrences = content.split(pair.old).length - 1
    edits.push({
      path,
      new_content: newContent,
      reason: `Replace ${occurrences} occurrence${occurrences === 1 ? '' : 's'} of \`${pair.old.slice(0, 80)}\``
    })
  }

  return { edits, matchedFiles }
}

/**
 * Top-level entry point: try to deterministically fix a typo-archetype issue.
 *
 * Return value:
 *   - null            → extraction failed or no files matched; caller should
 *                       fall through to the Claude tool-use loop
 *   - { edits, ... }  → deterministic fix succeeded; caller should commit +
 *                       open PR without invoking Claude
 */
async function tryDeterministicTypoFix ({ issue, ghAccess, logger }) {
  const pair = extractPairFromRegex(issue.title, issue.body)
  if (!pair) {
    if (logger) logger.info('[det-fix] No extractable pair from issue text; falling through to Claude loop')
    return null
  }
  if (logger) logger.info(`[det-fix] Extracted pair via ${pair.source}: "${pair.old}" → "${pair.new}"`)

  const { edits, matchedFiles } = await applyReplacement(pair, ghAccess)
  if (edits.length === 0) {
    if (logger) logger.info(`[det-fix] Pair extracted but not present in any file; falling through to Claude loop`)
    return null
  }

  const summary = `Deterministic find-and-replace: \`${pair.old}\` → \`${pair.new}\` (${edits.length} file${edits.length === 1 ? '' : 's'}, extracted via ${pair.source}).`
  if (logger) logger.info(`[det-fix] ${summary}`)

  return {
    edits,
    matchedFiles,
    pair,
    summary,
    source: 'deterministic'
  }
}

module.exports = {
  tryDeterministicTypoFix,
  extractPairFromRegex,
  applyReplacement,
  clean
}
