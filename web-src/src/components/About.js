import React from 'react'
import { Heading, View, Content, Link, Text } from '@adobe/react-spectrum'

export const About = () => (
  <View width="size-6000" padding="size-200">
    <Heading level={1}>About PRism</Heading>
    <Content>
      <Text>
        PRism is an autonomous AI engineer that triages open issues in Adobe aio
        public repos and drafts PRs. It was built during AUP AI Week 2026 as a
        showcase of App Builder as the platform for AI agents — every
        capability runs as an I/O Runtime action, state is persisted in
        aio-lib-state, and the review UI is a React Spectrum SPA extension.
      </Text>
      <Heading level={3}>Links</Heading>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        <li><Link><a href="https://developer.adobe.com/app-builder/" target="_blank" rel="noreferrer">Adobe Developer App Builder</a></Link></li>
        <li><Link><a href="https://github.com/adobe/aio-sdk" target="_blank" rel="noreferrer">Adobe I/O SDK</a></Link></li>
        <li><Link><a href="https://react-spectrum.adobe.com/react-spectrum/" target="_blank" rel="noreferrer">React Spectrum</a></Link></li>
        <li><Link><a href="https://docs.anthropic.com/" target="_blank" rel="noreferrer">Anthropic Claude API</a></Link></li>
      </ul>
    </Content>
  </View>
)
