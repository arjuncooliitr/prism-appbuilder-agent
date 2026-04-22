/*
 * PRReviewModal — fullscreen diff/body review with approve/reject.
 * Custom-styled dialog (no Spectrum chrome) to match the modern look.
 */

import React, { useEffect } from 'react'
import PropTypes from 'prop-types'

const ARCHETYPE_LABEL = {
  'typo': 'Typo',
  'dep-bump': 'Dep bump',
  'bug': 'Bug',
  'needs-human': 'Needs human'
}

/**
 * Renders a unified diff with +/-/hunk-header line coloring.
 */
function DiffView ({ diff }) {
  if (!diff) {
    return <pre className="code-block" style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>No diff.</pre>
  }
  const rows = diff.split('\n')
  return (
    <pre className="code-block diff-view" style={{ padding: 0 }}>
      {rows.map((line, i) => {
        let cls = 'diff-line'
        if (line.startsWith('@@')) cls += ' diff-hunk'
        else if (line.startsWith('+++ ') || line.startsWith('--- ')) cls += ' diff-meta'
        else if (line.startsWith('+')) cls += ' diff-add'
        else if (line.startsWith('-')) cls += ' diff-del'
        return (
          <span key={i} className={cls}>
            {line || ' '}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}

const PRReviewModal = ({ issue, onClose, onApprove, onReject, onRegenerate }) => {
  useEffect(() => {
    if (!issue) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [issue, onClose])

  if (!issue) return null

  const triage = issue.triage
  const draft = issue.draft

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(3, 3, 8, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 24
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '90vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-subtle)'
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Draft PR · {issue.repo}
            </div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>
              <span className="issue-num" style={{ fontSize: 16 }}>#{issue.number}</span>{' '}
              {issue.title}
            </h2>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="review" style={{ padding: 24, overflow: 'auto' }}>
          {triage && (() => {
            const prio = Math.min(3, Math.max(1, triage.priority || 3))
            return (
            <div className="review__section">
              <div className="review__label">Triage</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="badge badge--prio" data-prio={prio} style={{ '--prio': `var(--prio-${prio})` }}>
                  <span className="badge__dot" />P{prio}
                </span>
                <span className={`badge badge--${triage.freshness}`}><span className="badge__dot" />{triage.freshness}</span>
                <span className="badge badge--arche">{ARCHETYPE_LABEL[triage.archetype] || triage.archetype}</span>
              </div>
              {triage.rationale && <div className="review__body" style={{ fontStyle: 'italic', color: 'var(--text-2)' }}>{triage.rationale}</div>}
            </div>
            )
          })()}

          {draft ? (
            <>
              <div className="review__section">
                <div className="review__label">Proposed title</div>
                <div className="review__body">{draft.title}</div>
              </div>
              <div className="review__section">
                <div className="review__label">Branch</div>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-3)' }}>{draft.branch}</code>
              </div>
              <div className="review__section">
                <div className="review__label">PR body</div>
                <pre className="code-block">{draft.body}</pre>
              </div>
              <div className="review__section">
                <div className="review__label">
                  Diff {draft.files_changed && draft.files_changed.length ? `(${draft.files_changed.length} file${draft.files_changed.length === 1 ? '' : 's'})` : ''}
                </div>
                <DiffView diff={draft.diff || ''} />
                {draft.usage && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    {draft.iterations} iteration{draft.iterations === 1 ? '' : 's'} · {draft.usage.input_tokens} in / {draft.usage.output_tokens} out tokens · {draft.usage.cache_read_input_tokens || 0} cached
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="review__section" style={{ textAlign: 'center', color: 'var(--text-2)' }}>
              No draft attached to this issue. Click <strong>Generate draft</strong> below to run the fix pipeline now.
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '14px 24px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-0)'
        }}>
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
          <button className="btn btn--danger" onClick={() => onReject(issue)}>Reject</button>
          {!draft && onRegenerate ? (
            <button className="btn btn--primary" onClick={() => onRegenerate(issue)}>
              Generate draft
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => onApprove(issue)} disabled={!draft}>
              Approve &amp; mark ready
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

PRReviewModal.propTypes = {
  issue: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onApprove: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired,
  onRegenerate: PropTypes.func
}

export default PRReviewModal
