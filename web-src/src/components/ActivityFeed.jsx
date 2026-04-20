/*
 * ActivityFeed — rolling log of bot events in the dashboard sidebar.
 */

import React from 'react'
import PropTypes from 'prop-types'
import { View, Heading, Text, Flex, Divider, StatusLight } from '@adobe/react-spectrum'

const VARIANT = {
  fetched: 'info',
  triage: 'info',
  fix: 'notice',
  approve: 'positive',
  reject: 'negative',
  error: 'negative',
  review: 'neutral'
}

function format (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString()
}

const ActivityFeed = ({ entries }) => (
  <View borderRadius="medium" borderWidth="thin" borderColor="gray-300" padding="size-200" height="size-6000" overflow="auto">
    <Heading level={3} margin={0}>Activity</Heading>
    <Divider size="S" marginY="size-100" />
    {entries.length === 0 && <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>No activity yet.</Text>}
    <Flex direction="column" gap="size-100">
      {entries.map((e, i) => (
        <View key={i} paddingY="size-50">
          <Flex direction="row" alignItems="center" gap="size-100">
            <StatusLight variant={VARIANT[e.event] || 'neutral'}>{e.event}</StatusLight>
            <Text UNSAFE_style={{ fontSize: '11px', color: 'var(--spectrum-global-color-gray-600)' }}>{format(e.at)}</Text>
          </Flex>
          <Text UNSAFE_style={{ fontSize: '12px' }}>{e.text}</Text>
        </View>
      ))}
    </Flex>
  </View>
)

ActivityFeed.propTypes = {
  entries: PropTypes.array.isRequired
}

export default ActivityFeed
