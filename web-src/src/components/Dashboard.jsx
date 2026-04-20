/*
 * PRism — main dashboard view.
 * Pulls issue/PR state from the fetch-issues action and renders the triage queue.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import PropTypes from 'prop-types'
import {
  View,
  Flex,
  Heading,
  Text,
  Divider,
  ActionButton,
  Picker,
  Item,
  ProgressCircle,
  StatusLight
} from '@adobe/react-spectrum'
import Refresh from '@spectrum-icons/workflow/Refresh'

import allActions from '../config.json'
import actionWebInvoke from '../utils'
import IssueTable from './IssueTable'
import PRReviewModal from './PRReviewModal'
import ActivityFeed from './ActivityFeed'
import StatsStrip from './StatsStrip'

const actionUrl = (name) => allActions[`prism/${name}`] || allActions[name]

const Dashboard = ({ ims }) => {
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activity, setActivity] = useState([])
  const [reviewing, setReviewing] = useState(null)
  const [filters, setFilters] = useState({ repo: 'all', archetype: 'all', status: 'all' })

  const logActivity = useCallback((entry) => {
    setActivity(prev => [{ ...entry, at: new Date().toISOString() }, ...prev].slice(0, 50))
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
      logActivity({ event: 'fetched', text: `Fetched ${res.fetched_now || 0} new, ${list.length} total` })
    } catch (e) {
      setError(e.message)
      logActivity({ event: 'error', text: `fetch-issues failed: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }, [invoke, logActivity])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleAction = useCallback(async (action, issue) => {
    const params = { repo: issue.repo, number: issue.number }
    logActivity({ event: action, text: `${issue.repo}#${issue.number} — ${issue.title.slice(0, 80)}` })
    try {
      switch (action) {
        case 'triage':
          await invoke('triage-issue', params)
          break
        case 'fix':
          await invoke('fix-issue', params)
          await invoke('create-pr', params)
          break
        case 'approve':
          await invoke('approve-pr', { ...params, decision: 'approve' })
          break
        case 'reject':
          await invoke('approve-pr', { ...params, decision: 'reject' })
          break
        case 'review':
          setReviewing(issue)
          return
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
    return issues.filter(i => {
      if (filters.repo !== 'all' && i.repo !== filters.repo) return false
      if (filters.archetype !== 'all' && (!i.triage || i.triage.archetype !== filters.archetype)) return false
      if (filters.status !== 'all' && i.status !== filters.status) return false
      return true
    })
  }, [issues, filters])

  const repoOptions = useMemo(() => {
    const set = new Set(issues.map(i => i.repo))
    return [{ key: 'all', name: 'All repos' }, ...[...set].map(r => ({ key: r, name: r }))]
  }, [issues])

  return (
    <View padding="size-200">
      <Flex direction="row" alignItems="center" justifyContent="space-between" marginBottom="size-200">
        <Flex direction="column">
          <Heading level={1} margin={0}>PRism</Heading>
          <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>
            Autonomous issue triage and draft PRs for aio repos
          </Text>
        </Flex>
        <Flex direction="row" alignItems="center" gap="size-100">
          {loading && <ProgressCircle aria-label="refreshing" isIndeterminate size="S" />}
          <ActionButton onPress={refresh} isDisabled={loading}>
            <Refresh /><Text>Refresh</Text>
          </ActionButton>
        </Flex>
      </Flex>

      {error && (
        <View marginBottom="size-200">
          <StatusLight variant="negative">{error}</StatusLight>
        </View>
      )}

      <StatsStrip issues={issues} />
      <Divider size="S" marginY="size-200" />

      <Flex direction="row" gap="size-200" marginBottom="size-200">
        <Picker label="Repo" selectedKey={filters.repo} onSelectionChange={k => setFilters(f => ({ ...f, repo: k }))} items={repoOptions}>
          {(item) => <Item key={item.key}>{item.name}</Item>}
        </Picker>
        <Picker label="Archetype" selectedKey={filters.archetype} onSelectionChange={k => setFilters(f => ({ ...f, archetype: k }))}>
          <Item key="all">All</Item>
          <Item key="typo">Typo</Item>
          <Item key="dep-bump">Dep bump</Item>
          <Item key="bug">Bug</Item>
          <Item key="needs-human">Needs human</Item>
        </Picker>
        <Picker label="Status" selectedKey={filters.status} onSelectionChange={k => setFilters(f => ({ ...f, status: k }))}>
          <Item key="all">All</Item>
          <Item key="new">New</Item>
          <Item key="triaged">Triaged</Item>
          <Item key="pr-drafted">PR drafted</Item>
          <Item key="awaiting-review">Awaiting review</Item>
          <Item key="approved">Approved</Item>
          <Item key="rejected">Rejected</Item>
          <Item key="skipped">Skipped</Item>
        </Picker>
      </Flex>

      <Flex direction={{ base: 'column', L: 'row' }} gap="size-300">
        <View flex="3">
          <IssueTable issues={filtered} onAction={handleAction} />
        </View>
        <View flex="1" minWidth="size-3600">
          <ActivityFeed entries={activity} />
        </View>
      </Flex>

      <PRReviewModal
        issue={reviewing}
        onClose={() => setReviewing(null)}
        onApprove={async (iss) => { await handleAction('approve', iss); setReviewing(null) }}
        onReject={async (iss) => { await handleAction('reject', iss); setReviewing(null) }}
      />
    </View>
  )
}

Dashboard.propTypes = {
  ims: PropTypes.any
}

export default Dashboard
