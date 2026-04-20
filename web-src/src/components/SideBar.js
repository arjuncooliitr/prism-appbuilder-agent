import React from 'react'
import { NavLink } from 'react-router-dom'
import { Heading, Text, View } from '@adobe/react-spectrum'

function SideBar () {
  return (
    <View>
      <Heading level={2} margin={0}>PRism</Heading>
      <Text UNSAFE_style={{ fontSize: '11px', color: 'var(--spectrum-global-color-gray-700)' }}>
        aio issue → draft PR
      </Text>
      <ul className="SideNav" style={{ listStyle: 'none', padding: 0, marginTop: '24px' }}>
        <li className="SideNav-item">
          <NavLink
            className={({ isActive }) => `SideNav-itemLink ${isActive ? 'is-selected' : ''}`}
            aria-current="page"
            end
            to="/"
          >
            Dashboard
          </NavLink>
        </li>
        <li className="SideNav-item">
          <NavLink
            className={({ isActive }) => `SideNav-itemLink ${isActive ? 'is-selected' : ''}`}
            aria-current="page"
            to="/about"
          >
            About
          </NavLink>
        </li>
      </ul>
    </View>
  )
}

export default SideBar
