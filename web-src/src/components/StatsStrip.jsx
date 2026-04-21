/*
 * StatsStrip — header summary tiles, priority-coded left borders.
 */

import React, { useMemo } from 'react'
import PropTypes from 'prop-types'

const StatsStrip = ({ issues }) => {
  const stats = useMemo(() => {
    const by = { new: 0, triaged: 0, drafted: 0, awaiting: 0, approved: 0, merged: 0, rejected: 0, skipped: 0 }
    for (const i of issues) {
      const s = i.status || 'new'
      if (s === 'new') by.new++
      else if (s === 'triaged') by.triaged++
      else if (s === 'pr-drafted') by.drafted++
      else if (s === 'awaiting-review') by.awaiting++
      else if (s === 'approved') by.approved++
      else if (s === 'merged') by.merged++
      else if (s === 'rejected') by.rejected++
      else if (s === 'skipped') by.skipped++
    }
    return by
  }, [issues])

  const tiles = [
    { label: 'Total',    value: issues.length,                   variant: 'total' },
    { label: 'New',      value: stats.new,                       variant: 'new' },
    { label: 'Triaged',  value: stats.triaged,                   variant: 'triaged' },
    { label: 'Drafted',  value: stats.drafted + stats.awaiting,  variant: 'drafted' },
    { label: 'Approved', value: stats.approved + stats.merged,   variant: 'approved' },
    { label: 'Skipped',  value: stats.skipped + stats.rejected,  variant: 'skipped' }
  ]

  return (
    <div className="stats">
      {tiles.map(t => (
        <div key={t.label} className="stat" data-variant={t.variant}>
          <div className="stat__label">{t.label}</div>
          <div className="stat__value">{t.value}</div>
        </div>
      ))}
    </div>
  )
}

StatsStrip.propTypes = { issues: PropTypes.array.isRequired }

export default StatsStrip
