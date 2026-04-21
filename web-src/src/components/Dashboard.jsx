/*
 * PRism — main dashboard. Card-based issue queue with priority-coded stripes.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import PropTypes from 'prop-types'

import allActions from '../config.json'
import actionWebInvoke from '../utils'
import IssueCard from './IssueCard'
import PRReviewModal from './PRReviewModal'
import ActivityFeed from './ActivityFeed'
import StatsStrip from './StatsStrip'
import FilterBar from './FilterBar'

const actionUrl = (name) => allActions[`prism/${name}`] || allActions[name]

const Dashboard = ({ ims }) => {
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activity, setActivity] = useState([])
  const [reviewing, setReviewing] = useState(null)
  const [filters, setFilters] = useState({ repo: 'all', archetype: 'all', status: 'all' })

  const logActivity = useCallback((entry) => {
    setActivity(prev => [{ ...entry, at: new Date().toISOString() }, ...prev].slice(0, 60))
  }, [])

  const headers = useMemo(() => {
    const h = {}
    if (ims && ims.token) h.authorization = `Bearer ${ims.token}`
    if (ims && ims.org) h['x-gw-ims-org-id'] = ims.org
    return h
  }, [ims])

  const invoke = useCallback(async (name, params = {}) => {
    const url = actionUrl(name)
    if (!url) throw new Error(`Action URL not found for "${name}"`)
    return actionWebInvoke(url, headers, params)
  }, [headers])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invoke('fetch-issues')
      const list = (res && res.issues) || []
      setIssues(list)
      logActivity({ event: 'fetched', text: `${res.fetched_now || 0} new · ${list.length} total` })
    } catch (e) {
      setError(e.message)
      logActivity({ event: 'error', text: `fetch failed: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }, [invoke, logActivity])

  useEffect(() => { refresh() }, [refresh])

  const handleAction = useCallback(async (action, issue) => {
    const params = { repo: issue.repo, number: issue.number }
    logActivity({ event: action, text: `${issue.repo}#${issue.number} · ${issue.title.slice(0, 80)}` })
    try {
      switch (action) {
        case 'triage':
          await invoke('triage-issue', params); break
        case 'fix':
          await invoke('fix-issue', params)
          await invoke('create-pr', params)
          break
        case 'approve':
          await invoke('approve-pr', { ...params, decision: 'approve' }); break
        case 'reject':
          await invoke('approve-pr', { ...params, decision: 'reject' }); break
        case 'review':
          setReviewing(issue); return
        default:
          throw new Error(`Unknown action: ${action}`)
      }
      await refresh()
    } catch (e) {
      setError(e.message)
      logActivity({ event: 'error', text: `${action} failed: ${e.message}` })
    }
  }, [invoke, refresh, logActivity])

  const filtered = useMemo(() => {
    const FRESHNESS_RANK = { fresh: 0, active: 1, stale: 2 }
    return issues
      .filter(i => {
        if (filters.repo !== 'all' && i.repo !== filters.repo) return false
        if (filters.archetype !== 'all' && (!i.triage || i.triage.archetype !== filters.archetype)) return false
        if (filters.status !== 'all' && (i.status || 'new') !== filters.status) return false
        return true
      })
      .sort((a, b) => {
        const pA = (a.triage && a.triage.priority) || 99
        const pB = (b.triage && b.triage.priority) || 99
        if (pA !== pB) return pA - pB
        const fA = FRESHNESS_RANK[(a.triage && a.triage.freshness) || 'active']
        const fB = FRESHNESS_RANK[(b.triage && b.triage.freshness) || 'active']
        if (fA !== fB) return fA - fB
        return new Date(b.updated_at) - new Date(a.updated_at)
      })
  }, [issues, filters])

  const repoOptions = useMemo(() => {
    const set = new Set(issues.map(i => i.repo))
    return ['all', ...set]
  }, [issues])

  return (
    <>
      <div className="hero">
        <div>
          <h1 className="hero__title">Issue queue</h1>
          <div className="hero__subtitle">
            Triaged, ranked, and routed by Claude Opus — awaiting your review where it matters.
          </div>
        </div>
        <div className="hero__actions">
          {loading && <div className="spinner" aria-label="refreshing" />}
          <button className="btn" onClick={refresh} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error">
          <span>⚠</span><span>{error}</span>
        </div>
      )}

      <StatsStrip issues={issues} />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        repoOptions={repoOptions}
      />

      <div className="content-grid">
        <div>
          {filtered.length === 0 ? (
            <div className="empty">
              <div className="empty__icon">∅</div>
              <div>No issues match these filters.</div>
            </div>
          ) : (
            <div className="issue-list">
              {filtered.map(issue => (
                <IssueCard
                  key={`${issue.repo}#${issue.number}`}
                  issue={issue}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </div>
        <ActivityFeed entries={activity} />
      </div>

      <PRReviewModal
        issue={reviewing}
        onClose={() => setReviewing(null)}
        onApprove={async (iss) => { await handleAction('approve', iss); setReviewing(null) }}
        onReject={async (iss) => { await handleAction('reject', iss); setReviewing(null) }}
      />
    </>
  )
}

Dashboard.propTypes = { ims: PropTypes.any }

export default Dashboard
