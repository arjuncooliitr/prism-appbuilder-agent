/*
 * Prism root app shell. Top bar with Adobe mark + wordmark + theme toggle.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Provider, defaultTheme } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './Dashboard'
import { About } from './About'

const THEME_STORAGE_KEY = 'prism.theme'

function loadInitialTheme () {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch (_) { /* storage unavailable */ }
  // Default dark — Prism's palette is tuned for dark; light is an opt-in
  return 'dark'
}

function App (props) {
  props.runtime.on('configuration', () => {})
  props.runtime.on('history', () => {})

  const [theme, setTheme] = useState(loadInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme) } catch (_) {}
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }, [])

  return (
    <ErrorBoundary onError={() => {}} FallbackComponent={Fallback}>
      <Router>
        <Provider theme={defaultTheme} colorScheme={theme} UNSAFE_style={{ background: 'transparent' }}>
          <div className="app-shell">
            <header className="app-topbar">
              <div className="app-brand">
                <AdobeMark />
                <div className="app-brand__text">
                  <span className="app-brand__title">Prism</span>
                  <span className="app-brand__sub">Autonomous agentic dashboard for Adobe aio open-source maintenance</span>
                </div>
              </div>
              <div className="app-topbar__right">
                <nav className="app-nav">
                  <NavLink to="/" end className={({ isActive }) => isActive ? 'is-selected' : ''}>Dashboard</NavLink>
                  <NavLink to="/about" className={({ isActive }) => isActive ? 'is-selected' : ''}>About</NavLink>
                </nav>
                <button
                  className="theme-toggle"
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                </button>
              </div>
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

function AdobeMark () {
  // Adobe A mark — red square, white stylized A with the classic triangular notch.
  return (
    <span className="app-brand__logo" aria-label="Adobe">
      <svg width="22" height="22" viewBox="0 0 240 234" xmlns="http://www.w3.org/2000/svg">
        <path fill="#ffffff" d="M147.9 0h88.1v234zM55.8 0h-88v234zM101.9 86.4l56.1 147.6h-36.8l-16.8-42.3H62.4z" />
      </svg>
    </span>
  )
}

function SunIcon () {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon () {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function Fallback ({ componentStack, error }) {
  return (
    <div style={{ maxWidth: 720, margin: '80px auto', padding: 24, color: 'var(--text-0)' }}>
      <h1>Prism hit an unexpected error</h1>
      <pre style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 8, overflow: 'auto' }}>
        {componentStack + '\n' + (error && error.message)}
      </pre>
    </div>
  )
}

export default App
