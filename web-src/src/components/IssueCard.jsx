/*
 * IssueCard — one card per issue in the triage queue.
 * Priority-coded left stripe, metadata chips, status-aware CTAs.
 */

import React from 'react'
import PropTypes from 'prop-types'

const ARCHETYPE_LABEL = {
  'typo': 'Typo',
  'dep-bump': 'Dep bump',
  'bug': 'Bug',
  'needs-human': 'Needs human'
}

function relTime (iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function actionsForStatus (status, archetype) {
  switch (status) {
    case 'new':
      return [{ key: 'triage', label: 'Triage now', variant: 'primary' }]
    case 'triaged':
      if (archetype === 'needs-human') return [{ key: 'reject', label: 'Dismiss', variant: 'ghost' }]
      return [{ key: 'fix', label: 'Fix & draft PR', variant: 'primary' }]
    case 'pr-drafted':
    case 'awaiting-review':
      return [
        { key: 'review', label: 'Review PR', variant: 'primary' },
        { key: 'reject', label: 'Reject', variant: 'danger' }
      ]
    case 'approved':
    case 'merged':
      return [{ key: 'review', label: 'View PR', variant: 'ghost' }]
    case 'skipped':
    case 'rejected':
      return [{ key: 'triage', label: 'Retriage', variant: 'ghost' }]
    default:
      return [{ key: 'triage', label: 'Triage', variant: 'ghost' }]
  }
}

const IssueCard = ({ issue, onAction, isPending = false }) => {
  const status = issue.status || 'new'
  const triage = issue.triage
  const archetype = triage && triage.archetype
  // Coerce priority to the 3-level scheme (clamps legacy 4/5 state to low).
  const rawPrio = triage && triage.priority
  const prio = rawPrio == null ? null : Math.min(3, Math.max(1, rawPrio))
  const freshness = (triage && triage.freshness) || null
  const actions = isPending ? [] : actionsForStatus(status, archetype)
  const repoShort = issue.repo.split('/')[1] || issue.repo
  const effectiveStatus = isPending ? 'fixing' : status
  const statusLabel = isPending ? 'fixing' : status.replace(/-/g, ' ')

  return (
    <article className="issue-card" data-prio={prio || ''}>
      <div className="issue-head">
        <h3 className="issue-title">
          <span className="issue-num">#{issue.number}</span>
          <a href={issue.html_url} target="_blank" rel="noreferrer">{issue.title}</a>
        </h3>
        <span className={`status-pill status-${effectiveStatus}`}>
          {isPending ? <span className="status-pill__spinner" /> : <span className="status-pill__dot" />}
          {statusLabel}
        </span>
      </div>

      <div className="issue-meta">
        <span className="repo-chip">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          {repoShort}
        </span>
        {prio && (
          <span className="badge badge--prio">
            <span className="badge__dot" />
            P{prio}
          </span>
        )}
        {archetype && (
          <span className="badge badge--arche">{ARCHETYPE_LABEL[archetype] || archetype}</span>
        )}
        {freshness && (
          <span className={`badge badge--${freshness}`}>
            <span className="badge__dot" />
            {freshness}
          </span>
        )}
        {(issue.labels || []).slice(0, 3).map(l => (
          <span key={l} className="badge">{l}</span>
        ))}
      </div>

      {triage && triage.rationale && (
        <p className="issue-rationale">{triage.rationale}</p>
      )}

      <div className="issue-footer">
        <span className="issue-time">
          Updated {relTime(issue.updated_at)}
          {issue.comments > 0 && ` · ${issue.comments} comment${issue.comments === 1 ? '' : 's'}`}
          {issue.pr && issue.pr.url && issue.pr.number && (
            <>
              {' · '}
              <a
                href={issue.pr.url}
                target="_blank"
                rel="noreferrer"
                className="pr-link"
                onClick={(e) => e.stopPropagation()}
                title={`Open PR #${issue.pr.number} on GitHub`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                  <line x1="6" y1="9" x2="6" y2="21" />
                </svg>
                PR #{issue.pr.number}
              </a>
            </>
          )}
        </span>
        <div className="issue-actions">
          {isPending ? (
            <span className="pending-label">
              <span className="spinner spinner--sm" /> Prism is prisming…
            </span>
          ) : actions.map(a => (
            <button
              key={a.key}
              className={`btn btn--sm${a.variant ? ' btn--' + a.variant : ''}`}
              onClick={() => onAction(a.key, issue)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  )
}

IssueCard.propTypes = {
  issue: PropTypes.object.isRequired,
  onAction: PropTypes.func.isRequired,
  isPending: PropTypes.bool
}

export default IssueCard
