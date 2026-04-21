/*
 * FilterBar — pill-style filter chips for repo / archetype / status.
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
  { key: 'awaiting-review', label: 'Awaiting review' },
  { key: 'approved', label: 'Approved' },
  { key: 'skipped', label: 'Skipped' }
]

const FilterBar = ({ filters, onChange, repoOptions }) => {
  const repoChips = repoOptions.map(r => ({
    key: r,
    label: r === 'all' ? 'All repos' : r.split('/')[1] || r
  }))

  const update = (key, value) => onChange({ ...filters, [key]: value })

  return (
    <div className="filters">
      <FilterGroup
        label="Repo"
        options={repoChips}
        value={filters.repo}
        onSelect={(v) => update('repo', v)}
      />
      <FilterGroup
        label="Archetype"
        options={ARCHETYPES}
        value={filters.archetype}
        onSelect={(v) => update('archetype', v)}
      />
      <FilterGroup
        label="Status"
        options={STATUSES}
        value={filters.status}
        onSelect={(v) => update('status', v)}
      />
    </div>
  )
}

const FilterGroup = ({ label, options, value, onSelect }) => (
  <div className="filter-group">
    <span className="filter-group__label">{label}</span>
    {options.map(o => (
      <button
        key={o.key}
        className={`chip${value === o.key ? ' chip--active' : ''}`}
        onClick={() => onSelect(o.key)}
      >
        {o.label}
      </button>
    ))}
  </div>
)

FilterGroup.propTypes = {
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
