/*
 * FilterBar — segmented-control style filter groups.
 * Labels are stacked left; options are visually connected pill rows.
 */

import React from 'react'
import PropTypes from 'prop-types'

const ARCHETYPES = [
  { key: 'all', label: 'All' },
  { key: 'typo', label: 'Typo' },
  { key: 'dep-bump', label: 'Dep bump' },
  { key: 'bug', label: 'Bug' },
  { key: 'needs-human', label: 'Needs human' }
]

const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'triaged', label: 'Triaged' },
  { key: 'awaiting-review', label: 'Awaiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'skipped', label: 'Skipped' }
]

const FilterBar = ({ filters, onChange, repoOptions }) => {
  const repoChips = repoOptions.map(r => ({
    key: r,
    label: r === 'all' ? 'All' : r.split('/')[1] || r
  }))

  const update = (key, value) => onChange({ ...filters, [key]: value })

  return (
    <div className="filters-v2">
      <FilterRow label="Repo"       options={repoChips}  value={filters.repo}      onSelect={(v) => update('repo', v)} />
      <FilterRow label="Archetype"  options={ARCHETYPES} value={filters.archetype} onSelect={(v) => update('archetype', v)} />
      <FilterRow label="Status"     options={STATUSES}   value={filters.status}    onSelect={(v) => update('status', v)} />
    </div>
  )
}

const FilterRow = ({ label, options, value, onSelect }) => (
  <div className="filter-row">
    <span className="filter-row__label">{label}</span>
    <div className="segmented">
      {options.map(o => (
        <button
          key={o.key}
          className={`segmented__opt${value === o.key ? ' is-active' : ''}`}
          onClick={() => onSelect(o.key)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
)

FilterRow.propTypes = {
  label: PropTypes.string.isRequired,
  options: PropTypes.array.isRequired,
  value: PropTypes.string.isRequired,
  onSelect: PropTypes.func.isRequired
}

FilterBar.propTypes = {
  filters: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  repoOptions: PropTypes.array.isRequired
}

export default FilterBar
