/*
 * PRism root app shell. Wires the Dashboard into a dark-themed Spectrum Provider.
 */

import React from 'react'
import { Provider, defaultTheme, Grid, View } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import SideBar from './SideBar'
import Dashboard from './Dashboard'
import { About } from './About'

function App (props) {
  // exc-runtime wiring (IMS token changes, history events)
  props.runtime.on('configuration', () => {})
  props.runtime.on('history', () => {})

  return (
    <ErrorBoundary onError={() => {}} FallbackComponent={Fallback}>
      <Router>
        <Provider theme={defaultTheme} colorScheme="dark">
          <Grid
            areas={['sidebar content']}
            columns={['220px', '1fr']}
            rows={['auto']}
            height="100vh"
            gap="size-100"
          >
            <View gridArea="sidebar" backgroundColor="gray-200" padding="size-200">
              <SideBar />
            </View>
            <View gridArea="content" padding="size-100" overflow="auto">
              <Routes>
                <Route path="/" element={<Dashboard ims={props.ims} />} />
                <Route path="/about" element={<About />} />
              </Routes>
            </View>
          </Grid>
        </Provider>
      </Router>
    </ErrorBoundary>
  )
}

function Fallback ({ componentStack, error }) {
  return (
    <React.Fragment>
      <h1 style={{ textAlign: 'center', marginTop: '20px' }}>PRism hit an unexpected error</h1>
      <pre>{componentStack + '\n' + (error && error.message)}</pre>
    </React.Fragment>
  )
}

export default App
