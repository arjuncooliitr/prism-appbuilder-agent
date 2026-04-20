/*
 * IssueTable — the centerpiece of the PRism dashboard.
 * Renders the triage queue with LLM-scored priority, freshness, and status-aware actions.
 */

import React, { useMemo } from 'react'
import PropTypes from 'prop-types'
import {
  TableView,
  TableHeader,
  TableBody,
  Column,
  Row,
  Cell,
  Text,
  Flex,
  StatusLight,
  Link,
  TooltipTrigger,
  Tooltip,
  ActionGroup,
  Item
} from '@adobe/react-spectrum'

const PRIORITY_VARIANT = {
  1: 'negative',
  2: 'notice',
  3: 'yellow',
  4: 'info',
  5: 'neutral'
}

const ARCHETYPE_LABEL = {
  'typo': 'Typo',
  'dep-bump': 'Dep bump',
  'bug': 'Bug',
  'needs-human': 'Needs human'
}

const STATUS_VARIANT = {
  'new': 'neutral',
  'triaged': 'info',
  'fixing': 'notice',
  'pr-drafted': 'notice',
  'awaiting-review': 'notice',
  'approved': 'positive',
  'merged': 'positive',
  'rejected': 'negative',
  'skipped': 'neutral'
}

const FRESHNESS_RANK = { fresh: 0, active: 1, stale: 2 }

function relativeTime (iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function actionsForStatus (status, archetype) {
  switch (status) {
    case 'new':
      return [{ key: 'triage', label: 'Triage now' }]
    case 'triaged':
      if (archetype === 'needs-human') return [{ key: 'reject', label: 'Dismiss' }]
      return [{ key: 'fix', label: 'Fix & draft PR' }]
    case 'pr-drafted':
    case 'awaiting-review':
      return [
        { key: 'review', label: 'Review PR' },
        { key: 'reject', label: 'Reject' }
      ]
    case 'approved':
    case 'merged':
      return [{ key: 'review', label: 'View PR' }]
    case 'skipped':
    case 'rejected':
      return [{ key: 'triage', label: 'Retriage' }]
    default:
      return [{ key: 'triage', label: 'Triage' }]
  }
}

const IssueTable = ({ issues, onAction }) => {
  const sorted = useMemo(() => {
    return [...issues].sort((a, b) => {
      const pA = (a.triage && a.triage.priority) || 99
      const pB = (b.triage && b.triage.priority) || 99
      if (pA !== pB) return pA - pB
      const fA = FRESHNESS_RANK[(a.triage && a.triage.freshness) || 'active']
      const fB = FRESHNESS_RANK[(b.triage && b.triage.freshness) || 'active']
      if (fA !== fB) return fA - fB
      return new Date(b.updated_at) - new Date(a.updated_at)
    })
  }, [issues])

  const columns = [
    { uid: 'title', name: 'Title', width: '30%' },
    { uid: 'repo', name: 'Repo', width: '15%' },
    { uid: 'priority', name: 'Priority', width: '10%' },
    { uid: 'freshness', name: 'Freshness', width: '10%' },
    { uid: 'archetype', name: 'Archetype', width: '10%' },
    { uid: 'status', name: 'Status', width: '10%' },
    { uid: 'updated', name: 'Updated', width: '5%' },
    { uid: 'actions', name: 'Actions', width: '10%' }
  ]

  return (
    <TableView aria-label="Issue queue" overflowMode="truncate" density="compact">
      <TableHeader columns={columns}>
        {col => <Column key={col.uid} width={col.width}>{col.name}</Column>}
      </TableHeader>
      <TableBody items={sorted}>
        {item => (
          <Row key={`${item.repo}#${item.number}`}>
            {colKey => <Cell>{renderCell(colKey, item, onAction)}</Cell>}
          </Row>
        )}
      </TableBody>
    </TableView>
  )
}

function renderCell (colKey, item, onAction) {
  switch (colKey) {
    case 'title':
      return (
        <Link>
          <a href={item.html_url} target="_blank" rel="noreferrer">
            {`#${item.number} · ${item.title}`}
          </a>
        </Link>
      )
    case 'repo':
      return <Text>{item.repo.split('/')[1]}</Text>
    case 'priority': {
      const p = item.triage && item.triage.priority
      if (!p) return <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-500)' }}>—</Text>
      return (
        <TooltipTrigger>
          <StatusLight variant={PRIORITY_VARIANT[p] || 'neutral'}>P{p}</StatusLight>
          <Tooltip>{(item.triage && item.triage.rationale) || `Priority ${p}`}</Tooltip>
        </TooltipTrigger>
      )
    }
    case 'freshness': {
      const f = item.triage && item.triage.freshness
      if (!f) return <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-500)' }}>—</Text>
      return <StatusLight variant={f === 'fresh' ? 'positive' : f === 'stale' ? 'negative' : 'info'}>{f}</StatusLight>
    }
    case 'archetype': {
      const a = item.triage && item.triage.archetype
      return a ? <Text>{ARCHETYPE_LABEL[a] || a}</Text> : <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-500)' }}>—</Text>
    }
    case 'status':
      return <StatusLight variant={STATUS_VARIANT[item.status] || 'neutral'}>{item.status || 'new'}</StatusLight>
    case 'updated':
      return <Text>{relativeTime(item.updated_at)}</Text>
    case 'actions': {
      const archetype = item.triage && item.triage.archetype
      const choices = actionsForStatus(item.status || 'new', archetype)
      return (
        <ActionGroup
          isQuiet
          density="compact"
          overflowMode="collapse"
          buttonLabelBehavior="hide"
          onAction={(key) => onAction(key, item)}
          items={choices}
        >
          {(c) => <Item key={c.key}>{c.label}</Item>}
        </ActionGroup>
      )
    }
    default:
      return null
  }
}

IssueTable.propTypes = {
  issues: PropTypes.array.isRequired,
  onAction: PropTypes.func.isRequired
}

export default IssueTable
