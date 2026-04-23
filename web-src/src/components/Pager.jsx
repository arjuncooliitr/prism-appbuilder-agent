/*
 * Pager — compact page-number + prev/next control for the issue list.
 * Renders nothing if there's only one page.
 */

import React from 'react'
import PropTypes from 'prop-types'

/** Build a list of page numbers to show, with ellipses for gaps. */
function pageWindow (page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  // Always show first, last, and a window around current
  const out = new Set([1, totalPages, page - 1, page, page + 1])
  if (page <= 3) { out.add(2); out.add(3); out.add(4) }
  if (page >= totalPages - 2) { out.add(totalPages - 1); out.add(totalPages - 2); out.add(totalPages - 3) }
  const sorted = [...out].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const withGaps = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) withGaps.push('…')
    withGaps.push(sorted[i])
  }
  return withGaps
}

const Pager = ({ page, totalPages, totalItems, pageSize, onPageChange }) => {
  if (totalPages <= 1) {
    return (
      <div className="pager pager--single">
        <span className="pager__summary">{totalItems} of {totalItems}</span>
      </div>
    )
  }
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, totalItems)
  const entries = pageWindow(page, totalPages)
  return (
    <div className="pager">
      <span className="pager__summary">{first}–{last} of {totalItems}</span>
      <div className="pager__controls">
        <button
          className="pager__btn"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >‹</button>
        {entries.map((e, i) => e === '…' ? (
          <span key={`e-${i}`} className="pager__ellipsis">…</span>
        ) : (
          <button
            key={e}
            className={`pager__btn${e === page ? ' is-active' : ''}`}
            onClick={() => onPageChange(e)}
            aria-current={e === page ? 'page' : undefined}
          >{e}</button>
        ))}
        <button
          className="pager__btn"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >›</button>
      </div>
    </div>
  )
}

Pager.propTypes = {
  page: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  totalItems: PropTypes.number.isRequired,
  pageSize: PropTypes.number.isRequired,
  onPageChange: PropTypes.func.isRequired
}

export default Pager
