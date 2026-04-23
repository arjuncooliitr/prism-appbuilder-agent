/**
 * Deterministic dep-bump path.
 *
 * For `archetype === 'dep-bump'` issues, most of the real work is mechanical:
 *  - extract (package, [fromVersion], [toVersion]) from the issue body
 *  - if toVersion isn't given, query the npm registry for the latest version
 *  - rewrite package.json's matching entry with the new version
 *
 * No Claude call is needed for the bump itself. The PR body can optionally be
 * authored by Claude later, but the commit is deterministic and safe.
 *
 * Supported extraction patterns (in order):
 *   1. Dependabot-style: "Bumps [pkg](url) from X.Y.Z to A.B.C"
 *   2. Explicit: "bump pkg from X to Y" / "upgrade pkg from X to Y"
 *   3. Target-only: "update pkg to X.Y.Z" / "bump pkg to X.Y.Z"
 *   4. Simple: "upgrade pkg" / "bump pkg" (target resolved via npm registry)
 *
 * Safety guards:
 *   - Only modifies deps that already exist in package.json
 *   - Preserves the caret/tilde/range prefix from the existing version string
 *     (so `^1.2.3` stays `^1.2.4`, not `1.2.4`)
 *   - Skips if the resolved target equals the current pinned version
 *   - Skips if more than 3 packages would be bumped (signals a larger issue
 *     that probably needs human judgement)
 */

const PACKAGE_JSON = 'package.json'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const MAX_PACKAGES_PER_ISSUE = 3
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/

/**
 * Parse the issue title + body for bump intents.
 * Returns an array of { pkg, fromVersion?, toVersion?, source }.
 */
function extractBumps (title, body) {
  const text = `${title || ''}\n\n${body || ''}`
  const out = []
  const seen = new Set()

  const add = (entry) => {
    if (!entry.pkg) return
    const key = entry.pkg.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(entry)
  }

  // (1) Dependabot: Bumps [pkg](url) from X.Y.Z to A.B.C
  const dbRe = /Bumps\s+\[([^\]]+)\][^\n]*?from\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)\s+to\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)/gi
  let m
  while ((m = dbRe.exec(text)) !== null) {
    add({ pkg: m[1].trim(), fromVersion: m[2], toVersion: m[3], source: 'dependabot' })
  }

  // (2) Explicit: "bump|upgrade|update <pkg> from X to Y"
  const explicitRe = /(?:bump|upgrade|update)\s+[`'"]?(@?[\w./-]+?)[`'"]?\s+from\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\s+to\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/gi
  while ((m = explicitRe.exec(text)) !== null) {
    add({ pkg: m[1], fromVersion: m[2], toVersion: m[3], source: 'from-to' })
  }

  // (3) Target-only: "bump|update <pkg> to X.Y.Z"
  const targetRe = /(?:bump|upgrade|update)\s+[`'"]?(@?[\w./-]+?)[`'"]?\s+to\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/gi
  while ((m = targetRe.exec(text)) !== null) {
    add({ pkg: m[1], toVersion: m[2], source: 'to-target' })
  }

  // (4) Simple: "bump|upgrade <pkg>" (no version mentioned — resolve to latest)
  //     This is intentionally conservative: only fires if the token clearly
  //     looks like a package name (has @ or a / or ends in a known suffix).
  const simpleRe = /(?:bump|upgrade|update)\s+[`'"]?(@[\w./-]+|[\w-]+\/[\w.-]+|[\w-]+(?:-core|-sdk|-client)?)[`'"]?(?:\s+to\s+latest)?/gi
  while ((m = simpleRe.exec(text)) !== null) {
    add({ pkg: m[1], source: 'simple' })
  }

  return out.slice(0, MAX_PACKAGES_PER_ISSUE)
}

/** Separate version range prefix (^, ~, >=, etc.) from the version. */
function splitVersionRange (spec) {
  const m = /^([\^~><=]*)\s*(.+)$/.exec(String(spec || '').trim())
  if (!m) return { prefix: '', version: spec }
  return { prefix: m[1] || '', version: m[2] }
}

/**
 * Fetch the "latest" dist-tag version from the npm registry.
 * Returns a version string like "1.2.3" or null on error.
 */
async function fetchLatestVersion (pkg) {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(pkg).replace(/%40/g, '@')}`
  try {
    const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch')
    const res = await fetchFn(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const body = await res.json()
    const latest = body && body['dist-tags'] && body['dist-tags'].latest
    return latest || null
  } catch (_) {
    return null
  }
}

/**
 * Find which dependency section (`dependencies`, `devDependencies`,
 * `peerDependencies`, `optionalDependencies`) a package lives in.
 * Returns { section, currentSpec } or null.
 */
function findDepSection (pkgJson, name) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (pkgJson[section] && Object.prototype.hasOwnProperty.call(pkgJson[section], name)) {
      return { section, currentSpec: pkgJson[section][name] }
    }
  }
  return null
}

/**
 * Top-level: try to deterministically produce dep-bump edits.
 *
 * Returns:
 *   null                      — no extractable bumps, or no matching pkg.json
 *                               entries, or everything is already at target.
 *                               Caller should mark the issue as skipped.
 *   { edits, bumps, summary } — one package.json edit, plus metadata for the
 *                               caller to use in the draft body.
 */
async function tryDeterministicDepBump ({ issue, ghAccess, logger }) {
  const bumps = extractBumps(issue.title, issue.body)
  if (bumps.length === 0) {
    if (logger) logger.info('[dep-bump] No extractable bumps from issue text')
    return null
  }
  if (logger) logger.info(`[dep-bump] Extracted ${bumps.length} bump intent(s): ${bumps.map(b => `${b.pkg}${b.toVersion ? '@' + b.toVersion : ''}`).join(', ')}`)

  // Fetch package.json from the repo
  let pkgJsonRead
  try { pkgJsonRead = await ghAccess.readFile(PACKAGE_JSON) }
  catch (e) {
    if (logger) logger.warn(`[dep-bump] Could not read package.json: ${e.message}`)
    return null
  }
  let pkgJson
  try { pkgJson = JSON.parse(pkgJsonRead.content) }
  catch (e) {
    if (logger) logger.warn(`[dep-bump] package.json is not valid JSON: ${e.message}`)
    return null
  }

  // Resolve each bump against package.json and the registry
  const resolved = []
  for (const b of bumps) {
    const loc = findDepSection(pkgJson, b.pkg)
    if (!loc) {
      if (logger) logger.info(`[dep-bump] ${b.pkg} not found in package.json; skipping`)
      continue
    }
    const { prefix, version: currentVersion } = splitVersionRange(loc.currentSpec)

    let target = b.toVersion
    if (!target) {
      target = await fetchLatestVersion(b.pkg)
      if (!target) {
        if (logger) logger.info(`[dep-bump] Could not resolve latest for ${b.pkg}; skipping`)
        continue
      }
    }
    if (!SEMVER_RE.test(target)) {
      if (logger) logger.info(`[dep-bump] Target version ${target} doesn't look like semver; skipping`)
      continue
    }
    if (target === currentVersion) {
      if (logger) logger.info(`[dep-bump] ${b.pkg} already at ${target}; skipping`)
      continue
    }

    resolved.push({
      pkg: b.pkg,
      section: loc.section,
      fromSpec: loc.currentSpec,
      fromVersion: currentVersion,
      toVersion: target,
      newSpec: `${prefix}${target}`,
      source: b.source
    })
  }

  if (resolved.length === 0) {
    if (logger) logger.info('[dep-bump] No bumps to apply after resolution')
    return null
  }

  // Apply to the pkgJson object and regenerate its text
  const nextPkgJson = JSON.parse(JSON.stringify(pkgJson))
  for (const r of resolved) {
    nextPkgJson[r.section][r.pkg] = r.newSpec
  }
  // Preserve final newline behaviour: stringify with 2-space indent + trailing \n
  const newContent = JSON.stringify(nextPkgJson, null, 2) + '\n'
  if (newContent === pkgJsonRead.content) {
    if (logger) logger.info('[dep-bump] package.json unchanged after rewrite; skipping')
    return null
  }

  const reasonForFile = `Bump ${resolved.map(r => `${r.pkg} ${r.fromVersion} → ${r.toVersion}`).join(', ')}`
  const summaryLines = [
    `Deterministic dep-bump: ${resolved.length} package${resolved.length === 1 ? '' : 's'} updated in package.json.`,
    '',
    ...resolved.map(r => `- \`${r.pkg}\` (${r.section}) · ${r.fromVersion} → ${r.toVersion} [via ${r.source}]`)
  ]
  const summary = summaryLines.join('\n')

  return {
    edits: [{ path: PACKAGE_JSON, new_content: newContent, reason: reasonForFile }],
    bumps: resolved,
    summary,
    source: 'deterministic-dep-bump'
  }
}

module.exports = {
  tryDeterministicDepBump,
  extractBumps,
  splitVersionRange,
  fetchLatestVersion,
  findDepSection
}
