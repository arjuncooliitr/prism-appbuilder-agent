/*
 * PRism root app shell. Modern top-bar + content area layout.
 */

import React from 'react'
import { Provider, defaultTheme } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './Dashboard'
import { About } from './About'

function App (props) {
  props.runtime.on('configuration', () => {})
  props.runtime.on('history', () => {})

  return (
    <ErrorBoundary onError={() => {}} FallbackComponent={Fallback}>
      <Router>
        <Provider theme={defaultTheme} colorScheme="dark" UNSAFE_style={{ background: 'transparent' }}>
          <div className="app-shell">
            <header className="app-topbar">
              <div className="app-brand">
                <div className="app-brand__logo">P</div>
                <div>
                  <span className="app-brand__title">PRism</span>
                  <span className="app-brand__sub">autonomous issue triage for aio repos</span>
                </div>
              </div>
              <nav className="app-nav">
                <NavLink to="/" end className={({ isActive }) => isActive ? 'is-selected' : ''}>Dashboard</NavLink>
                <NavLink to="/about" className={({ isActive }) => isActive ? 'is-selected' : ''}>About</NavLink>
              </nav>
            </header>
            <main className="app-main">
              <Routes>
                <Route path="/" element={<Dashboard ims={props.ims} />} />
                <Route path="/about" element={<About />} />
              </Routes>
            </main>
          </div>
        </Provider>
      </Router>
    </ErrorBoundary>
  )
}

function Fallback ({ componentStack, error }) {
  return (
    <div style={{ maxWidth: 720, margin: '80px auto', padding: 24, color: '#f4f4f8' }}>
      <h1>PRism hit an unexpected error</h1>
      <pre style={{ background: '#141420', padding: 16, borderRadius: 8, overflow: 'auto' }}>
        {componentStack + '\n' + (error && error.message)}
      </pre>
    </div>
  )
}

export default App
