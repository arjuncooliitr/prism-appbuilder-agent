/**
 * Minimal unified-diff generator for PRism.
 *
 * Good enough for the dashboard diff preview — not a full git-diff replacement.
 * Uses a simple LCS-based line diff. For large files we fall back to showing
 * only hunks of changed lines (context = 3).
 */

function lines (s) {
  if (s === '' || s == null) return []
  return s.split('\n')
}

/** Compute line-level LCS matrix between two arrays of strings. */
function lcsMatrix (a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

/**
 * Produce a list of operations: [{ op: 'eq'|'add'|'del', text, aLine, bLine }]
 */
function computeOps (a, b) {
  const dp = lcsMatrix(a, b)
  const ops = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: 'eq', text: a[i], aLine: i + 1, bLine: j + 1 })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'del', text: a[i], aLine: i + 1, bLine: null })
      i++
    } else {
      ops.push({ op: 'add', text: b[j], aLine: null, bLine: j + 1 })
      j++
    }
  }
  while (i < a.length) { ops.push({ op: 'del', text: a[i], aLine: i + 1, bLine: null }); i++ }
  while (j < b.length) { ops.push({ op: 'add', text: b[j], aLine: null, bLine: j + 1 }); j++ }
  return ops
}

/**
 * Group ops into hunks with `context` lines of surrounding equal lines.
 */
function hunks (ops, context = 3) {
  const out = []
  let current = null
  let eqRun = 0
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.op === 'eq') {
      if (current) {
        if (eqRun < context) {
          current.ops.push(op)
        } else if (eqRun === context) {
          // still trailing context, stop adding
        }
        eqRun++
        if (eqRun > context * 2) {
          out.push(current)
          current = null
          eqRun = 0
        }
      }
    } else {
      if (!current) {
        // start a new hunk — backfill up to `context` eq lines
        current = { ops: [] }
        const start = Math.max(0, k - context)
        for (let p = start; p < k; p++) if (ops[p].op === 'eq') current.ops.push(ops[p])
      }
      // if we were cruising through eq lines but hadn't closed hunk, keep them
      current.ops.push(op)
      eqRun = 0
    }
  }
  if (current) out.push(current)
  return out
}

/** Render hunks as unified-diff text for a single file. */
function renderUnified (filePath, before, after) {
  const a = lines(before)
  const b = lines(after)
  const ops = computeOps(a, b)
  const h = hunks(ops, 3)

  let out = `--- a/${filePath}\n+++ b/${filePath}\n`
  for (const hunk of h) {
    const first = hunk.ops[0]
    const aStart = first.aLine != null ? first.aLine : (first.bLine || 1)
    const bStart = first.bLine != null ? first.bLine : (first.aLine || 1)
    const aLen = hunk.ops.filter(o => o.op !== 'add').length
    const bLen = hunk.ops.filter(o => o.op !== 'del').length
    out += `@@ -${aStart},${aLen} +${bStart},${bLen} @@\n`
    for (const op of hunk.ops) {
      const prefix = op.op === 'eq' ? ' ' : op.op === 'add' ? '+' : '-'
      out += `${prefix}${op.text}\n`
    }
  }
  return out
}

/** Render multiple file edits into a single unified-diff string. */
function renderAll (edits) {
  // edits: [{ path, beforeContent, afterContent }]
  return edits.map(e => renderUnified(e.path, e.beforeContent || '', e.afterContent || '')).join('\n')
}

module.exports = { renderUnified, renderAll, computeOps, hunks }
