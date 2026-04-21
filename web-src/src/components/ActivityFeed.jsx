/*
 * ActivityFeed — timeline-style log of bot events in the right panel.
 */

import React from 'react'
import PropTypes from 'prop-types'

function fmt (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

const ActivityFeed = ({ entries }) => (
  <aside className="panel">
    <div className="panel__head">
      <h3 className="panel__title">Activity</h3>
      <span className="panel__count">{entries.length}</span>
    </div>
    <div className="panel__body">
      {entries.length === 0 ? (
        <div style={{ padding: '12px 0', color: 'var(--text-3)', fontSize: 12 }}>
          No activity yet. Trigger an action from a card to see events flow here.
        </div>
      ) : (
        <ul className="timeline" style={{ listStyle: 'none', margin: 0, padding: 0, paddingLeft: 18 }}>
          {entries.map((e, i) => (
            <li key={i} className="timeline__item" data-kind={e.event}>
              <span className="timeline__dot" />
              <div className="timeline__head">
                <span className="timeline__kind">{e.event}</span>
                <span className="timeline__time">{fmt(e.at)}</span>
              </div>
              <span className="timeline__text">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </aside>
)

ActivityFeed.propTypes = { entries: PropTypes.array.isRequired }

export default ActivityFeed
