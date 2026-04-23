/*
 * Prism — main dashboard. Card-based issue queue with priority-coded stripes.
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
import Pager from './Pager'
import SettingsModal from './SettingsModal'

const actionUrl = (name) => allActions[`prism/${name}`] || allActions[name]

const PAGE_SIZE = 10

const Dashboard = ({ ims }) => {
  const [issues, setIssues] = useState([])
  const [targetRepos, setTargetRepos] = useState([])
  const [settingsSource, setSettingsSource] = useState('env') // 'env' | 'state'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activity, setActivity] = useState([])
  const [reviewing, setReviewing] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filters, setFilters] = useState({ repo: 'all', priority: 'all', archetype: 'all', status: 'all' })
  const [page, setPage] = useState(1)
  const [pendingFix, setPendingFix] = useState({})

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

  const applyFetchResponse = useCallback((res) => {
    const list = (res && res.issues) || []
    setIssues(list)
    if (Array.isArray(res && res.target_repos)) setTargetRepos(res.target_repos)
    if (res && res.settings_source) setSettingsSource(res.settings_source)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invoke('fetch-issues')
      applyFetchResponse(res)
      logActivity({ event: 'fetched', text: `${(res && res.fetched_now) || 0} new · ${(res && res.issues || []).length} total` })
    } catch (e) {
      setError(e.message)
      logActivity({ event: 'error', text: `fetch failed: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }, [invoke, applyFetchResponse, logActivity])

  useEffect(() => { refresh() }, [refresh])

  const key = (iss) => `${iss.repo}#${iss.number}`

  const handleAction = useCallback(async (action, issue) => {
    const params = { repo: issue.repo, number: issue.number }
    logActivity({ event: action, text: `${issue.repo}#${issue.number} · ${issue.title.slice(0, 80)}` })
    try {
      switch (action) {
        case 'triage':
          await invoke('triage-issue', params); break
        case 'fix':
          setPendingFix(m => ({ ...m, [key(issue)]: { startedAt: Date.now(), kind: 'fix' } }))
          try { await invoke('fix-issue', params) }
          catch (e) { if (!e.isGatewayTimeout) throw e; logActivity({ event: 'fix', text: `${issue.repo}#${issue.number} · running in background (504 expected)` }) }
          break
        case 'refix': {
          const refixBaseline = (issue.refix_history || []).length
          setPendingFix(m => ({ ...m, [key(issue)]: { startedAt: Date.now(), kind: 'refix', baseline: refixBaseline } }))
          try { await invoke('refix-pr', params) }
          catch (e) { if (!e.isGatewayTimeout) throw e; logActivity({ event: 'refix', text: `${issue.repo}#${issue.number} · revising in background` }) }
          break
        }
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

  // Poll loop while any fix is pending.
  useEffect(() => {
    const active = Object.keys(pendingFix)
    if (active.length === 0) return undefined
    const timer = setInterval(async () => {
      try {
        const res = await invoke('fetch-issues')
        applyFetchResponse(res)
        const list = (res && res.issues) || []
        setPendingFix(prev => {
          const next = { ...prev }
          const now = Date.now()
          for (const k of Object.keys(next)) {
            const entry = next[k]
            const [r, n] = k.split('#')
            const iss = list.find(i => i.repo === r && String(i.number) === n)
            let settled = false
            if (iss) {
              if (entry.kind === 'refix') {
                const currentCount = (iss.refix_history || []).length
                settled = currentCount > (entry.baseline || 0)
              } else {
                settled = ['pr-drafted', 'awaiting-review', 'approved', 'skipped', 'rejected'].includes(iss.status)
              }
            }
            const timedOut = now - entry.startedAt > 10 * 60 * 1000
            if (settled || timedOut) {
              if (settled && iss) {
                const label = entry.kind === 'refix' ? `re-fixed (attempt ${(iss.refix_history || []).length})` : `settled: ${iss.status}`
                logActivity({ event: entry.kind || 'fix', text: `${iss.repo}#${iss.number} · ${label}` })
              }
              if (timedOut && !settled) logActivity({ event: 'error', text: `${r}#${n} polling gave up after 10min` })
              delete next[k]
            }
          }
          return next
        })
      } catch (_) { /* next tick will retry */ }
    }, 8000)
    return () => clearInterval(timer)
  }, [pendingFix, invoke, applyFetchResponse, logActivity])

  // Apply the target-repo filter first — issues from repos no longer watched
  // are in state but shouldn't render. targetRepos being empty means we haven't
  // received a response yet, so fall through (don't mask issues on first render).
  const watchedIssues = useMemo(() => {
    if (!targetRepos || targetRepos.length === 0) return issues
    const set = new Set(targetRepos)
    return issues.filter(i => set.has(i.repo))
  }, [issues, targetRepos])

  const filtered = useMemo(() => {
    const FRESHNESS_RANK = { fresh: 0, active: 1, stale: 2 }
    return watchedIssues
      .filter(i => {
        if (filters.repo !== 'all' && i.repo !== filters.repo) return false
        if (filters.priority !== 'all') {
          const raw = i.triage && i.triage.priority
          const p = raw == null ? null : String(Math.min(3, Math.max(1, raw)))
          if (p !== filters.priority) return false
        }
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
  }, [watchedIssues, filters])

  // Reset to page 1 whenever the filtered set shrinks past the current page
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])
  useEffect(() => { setPage(1) }, [filters])

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const repoOptions = useMemo(() => ['all', ...targetRepos], [targetRepos])

  // Settings callbacks
  const handleSettings = useCallback(async (op, repo, extra = {}) => {
    const res = await invoke('settings', { op, repo, ...extra })
    const list = (res && res.target_repos) || []
    setTargetRepos(list)
    setSettingsSource(res && res.source || 'state')
    if (op === 'add_repo') logActivity({ event: 'fetched', text: `repo added · ${repo}` })
    if (op === 'remove_repo') logActivity({ event: 'fetched', text: `repo removed · ${repo}${res && res.pruned_issues ? ` (${res.pruned_issues} issues pruned)` : ''}` })
    // After changing the list, immediately refresh so new repos get polled
    if (op === 'add_repo') await refresh()
    return res
  }, [invoke, refresh, logActivity])

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
          <button className="btn btn--ghost" onClick={() => setSettingsOpen(true)} title="Manage watched repos">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Repos
          </button>
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

      <StatsStrip issues={watchedIssues} />

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
            <>
              <div className="issue-list">
                {paged.map(issue => (
                  <IssueCard
                    key={`${issue.repo}#${issue.number}`}
                    issue={issue}
                    onAction={handleAction}
                    isPending={Boolean(pendingFix[`${issue.repo}#${issue.number}`])}
                  />
                ))}
              </div>
              <Pager
                page={page}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
        <ActivityFeed entries={activity} />
      </div>

      <PRReviewModal
        issue={reviewing}
        onClose={() => setReviewing(null)}
        onApprove={async (iss) => { await handleAction('approve', iss); setReviewing(null) }}
        onReject={async (iss) => { await handleAction('reject', iss); setReviewing(null) }}
        onRegenerate={async (iss) => { await handleAction('fix', iss); setReviewing(null) }}
      />

      {settingsOpen && (
        <SettingsModal
          targetRepos={targetRepos}
          source={settingsSource}
          onClose={() => setSettingsOpen(false)}
          onAdd={(repo) => handleSettings('add_repo', repo)}
          onRemove={(repo, prune) => handleSettings('remove_repo', repo, { prune })}
        />
      )}
    </>
  )
}

Dashboard.propTypes = { ims: PropTypes.any }

export default Dashboard
