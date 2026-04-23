/*
 * SettingsModal — add/remove watched repos from the dashboard.
 *
 * Changes are persisted to aio-lib-state via the `settings` action and take
 * effect on the next fetch-issues cycle. Removed repos are filtered client-
 * side immediately; their state records can optionally be pruned.
 */

import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

const SettingsModal = ({ targetRepos, source, onClose, onAdd, onRemove }) => {
  const [input, setInput] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pruneOnRemove, setPruneOnRemove] = useState(true)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleAdd = async (e) => {
    if (e) e.preventDefault()
    const repo = input.trim()
    if (!REPO_RE.test(repo)) {
      setError('Enter a repo in the form "owner/name"')
      return
    }
    if (targetRepos.includes(repo)) {
      setError(`${repo} is already being watched`)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onAdd(repo)
      setInput('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (repo) => {
    const confirmMsg = pruneOnRemove
      ? `Remove ${repo} from the watch list AND delete its cached issue records?`
      : `Remove ${repo} from the watch list? (Cached issues will stay in state but won't render.)`
    if (!window.confirm(confirmMsg)) return
    setBusy(true)
    try { await onRemove(repo, pruneOnRemove) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(3, 3, 8, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'grid', placeItems: 'center',
        zIndex: 100, padding: 24
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-subtle)'
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Configuration · <span style={{ color: source === 'state' ? 'var(--ok)' : 'var(--text-3)' }}>{source === 'state' ? 'persisted' : 'from env'}</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Watched repos</h2>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: '18px 24px', overflow: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
              Prism polls these repos on every refresh. Write access (maintainer/admin) is required for each repo that should accept real PRs.
            </div>
            {targetRepos.length === 0 ? (
              <div className="empty" style={{ padding: 16 }}>No repos configured. Add one below.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {targetRepos.map(repo => (
                  <li key={repo} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius)',
                    fontSize: 13
                  }}>
                    <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-0)' }}>
                      {repo}
                    </a>
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => handleRemove(repo)}
                      disabled={busy}
                    >Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(null) }}
              placeholder="adobe/aio-cli-plugin-certificate"
              style={{
                flex: 1,
                padding: '8px 12px',
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text-0)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                outline: 'none'
              }}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !input.trim()}
            >Add</button>
          </form>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={pruneOnRemove}
              onChange={(e) => setPruneOnRemove(e.target.checked)}
            />
            When removing a repo, also delete its cached issue records
          </label>

          {error && (
            <div className="alert alert--error" style={{ marginTop: 12 }}>
              <span>⚠</span><span>{error}</span>
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          padding: '12px 24px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-0)'
        }}>
          <button className="btn btn--ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

SettingsModal.propTypes = {
  targetRepos: PropTypes.array.isRequired,
  source: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onAdd: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired
}

export default SettingsModal
