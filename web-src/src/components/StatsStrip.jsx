/*
 * StatsStrip — header summary of the issue queue.
 */

import React, { useMemo } from 'react'
import PropTypes from 'prop-types'
import { Flex, View, Heading, Text } from '@adobe/react-spectrum'

const Tile = ({ label, value }) => (
  <View
    backgroundColor="gray-100"
    borderRadius="medium"
    padding="size-200"
    minWidth="size-2000"
  >
    <Text UNSAFE_style={{ fontSize: '11px', color: 'var(--spectrum-global-color-gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}
    </Text>
    <Heading level={2} margin={0}>{value}</Heading>
  </View>
)

Tile.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.node.isRequired }

const StatsStrip = ({ issues }) => {
  const stats = useMemo(() => {
    const by = { new: 0, triaged: 0, drafted: 0, awaiting: 0, approved: 0, merged: 0, rejected: 0, skipped: 0 }
    for (const i of issues) {
      const s = i.status || 'new'
      if (s === 'new') by.new++
      else if (s === 'triaged') by.triaged++
      else if (s === 'pr-drafted') by.drafted++
      else if (s === 'awaiting-review') by.awaiting++
      else if (s === 'approved') by.approved++
      else if (s === 'merged') by.merged++
      else if (s === 'rejected') by.rejected++
      else if (s === 'skipped') by.skipped++
    }
    return by
  }, [issues])

  return (
    <Flex direction="row" gap="size-200" wrap>
      <Tile label="Total" value={issues.length} />
      <Tile label="New" value={stats.new} />
      <Tile label="Triaged" value={stats.triaged} />
      <Tile label="Drafted" value={stats.drafted + stats.awaiting} />
      <Tile label="Approved" value={stats.approved + stats.merged} />
      <Tile label="Skipped" value={stats.skipped + stats.rejected} />
    </Flex>
  )
}

StatsStrip.propTypes = { issues: PropTypes.array.isRequired }

export default StatsStrip
