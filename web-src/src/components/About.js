import React from 'react'

export const About = () => (
  <div style={{ maxWidth: 720 }}>
    <div className="hero">
      <div>
        <h1 className="hero__title">About Prism</h1>
        <div className="hero__subtitle">Built during AUP AI Week 2026.</div>
      </div>
    </div>

    <div className="review__section" style={{ marginBottom: 16 }}>
      <div className="review__label">Purpose</div>
      <div className="review__body">
        Prism is an autonomous AI agent that triages open issues in Adobe aio
        public repos and drafts PRs — built on App Builder itself, so the same
        platform that powers Experience Cloud apps now powers an agent that
        improves App Builder&apos;s own open-source ecosystem. Every capability
        runs as an I/O Runtime action, state is persisted in{' '}
        <code>aio-lib-state</code>, and the review UI you&apos;re looking at is
        a React Spectrum extension. Reasoning is powered by Claude Opus via
        Amazon Bedrock.
      </div>
    </div>

    <div className="review__section" style={{ marginBottom: 16 }}>
      <div className="review__label">Author</div>
      <div className="review__body">
        Built by{' '}
        <a href="https://github.com/arjuncooliitr" target="_blank" rel="noreferrer">
          Arjun Gupta
        </a>
        {' '}· Adobe Developer Platform India. Source on{' '}
        <a href="https://github.com/arjuncooliitr/prism-appbuilder-agent" target="_blank" rel="noreferrer">
          GitHub
        </a>.
      </div>
    </div>

    <div className="review__section">
      <div className="review__label">Links</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li><a href="https://developer.adobe.com/app-builder/" target="_blank" rel="noreferrer">Adobe Developer App Builder →</a></li>
        <li><a href="https://github.com/adobe/aio-sdk" target="_blank" rel="noreferrer">Adobe I/O SDK →</a></li>
        <li><a href="https://react-spectrum.adobe.com/react-spectrum/" target="_blank" rel="noreferrer">React Spectrum →</a></li>
        <li><a href="https://aws.amazon.com/bedrock/claude/" target="_blank" rel="noreferrer">Claude on Amazon Bedrock →</a></li>
        <li><a href="https://github.com/arjuncooliitr/prism-appbuilder-agent" target="_blank" rel="noreferrer">Prism on GitHub →</a></li>
      </ul>
    </div>
  </div>
)
