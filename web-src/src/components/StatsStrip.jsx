/*
 * StatsStrip — compact single-row summary: big total, segmented progress bar,
 * inline legend chips for each status with counts.
 */

import React, { useMemo } from 'react'
import PropTypes from 'prop-types'

const SEGMENTS = [
  { key: 'new',       label: 'New' },
  { key: 'triaged',   label: 'Triaged' },
  { key: 'drafted',   label: 'Drafted' },
  { key: 'approved',  label: 'Approved' },
  { key: 'skipped',   label: 'Skipped' }
]

const StatsStrip = ({ issues }) => {
  const counts = useMemo(() => {
    const c = { new: 0, triaged: 0, drafted: 0, approved: 0, skipped: 0 }
    for (const i of issues) {
      const s = i.status || 'new'
      if (s === 'new') c.new++
      else if (s === 'triaged') c.triaged++
      else if (s === 'pr-drafted' || s === 'awaiting-review') c.drafted++
      else if (s === 'approved' || s === 'merged') c.approved++
      else c.skipped++
    }
    return c
  }, [issues])

  const total = issues.length
  const pct = (n) => total === 0 ? 0 : (n / total) * 100

  return (
    <div className="stats-bar">
      <div className="stats-bar__total">
        <span className="stats-bar__total-value">{total}</span>
        <span className="stats-bar__total-label">{total === 1 ? 'issue' : 'issues'}</span>
      </div>

      <div className="stats-bar__progress" aria-label="Status breakdown">
        {total === 0 ? (
          <div className="stats-bar__empty" />
        ) : (
          SEGMENTS.map(seg => counts[seg.key] > 0 && (
            <div
              key={seg.key}
              className="stats-bar__seg"
              data-variant={seg.key}
              style={{ width: `${pct(counts[seg.key])}%` }}
              title={`${seg.label}: ${counts[seg.key]}`}
            />
          ))
        )}
      </div>

      <div className="stats-bar__legend">
        {SEGMENTS.map(seg => (
          <span
            key={seg.key}
            className="stats-legend-item"
            data-variant={seg.key}
            data-zero={counts[seg.key] === 0 ? 'true' : 'false'}
          >
            <span className="stats-legend-item__dot" />
            <span className="stats-legend-item__label">{seg.label}</span>
            <span className="stats-legend-item__value">{counts[seg.key]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

StatsStrip.propTypes = { issues: PropTypes.array.isRequired }

export default StatsStrip
