import React from 'react'

export const About = () => (
  <div style={{ maxWidth: 720 }}>
    <div className="hero">
      <div>
        <h1 className="hero__title">About PRism</h1>
        <div className="hero__subtitle">Built during AUP AI Week 2026.</div>
      </div>
    </div>

    <div className="review__section" style={{ marginBottom: 16 }}>
      <div className="review__label">Purpose</div>
      <div className="review__body">
        PRism is an autonomous AI engineer that triages open issues in Adobe aio
        public repos and drafts PRs. Every capability runs as an I/O Runtime
        action, state is persisted in <code>aio-lib-state</code>, and the review
        UI you&apos;re looking at is a React Spectrum extension. Reasoning is
        powered by Claude Opus 4.6.
      </div>
    </div>

    <div className="review__section" style={{ marginBottom: 16 }}>
      <div className="review__label">Narrative</div>
      <div className="review__body" style={{ fontStyle: 'italic', color: 'var(--text-1)' }}>
        &ldquo;Built on App Builder to improve App Builder.&rdquo;
      </div>
    </div>

    <div className="review__section">
      <div className="review__label">Links</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li><a href="https://developer.adobe.com/app-builder/" target="_blank" rel="noreferrer">Adobe Developer App Builder →</a></li>
        <li><a href="https://github.com/adobe/aio-sdk" target="_blank" rel="noreferrer">Adobe I/O SDK →</a></li>
        <li><a href="https://react-spectrum.adobe.com/react-spectrum/" target="_blank" rel="noreferrer">React Spectrum →</a></li>
        <li><a href="https://docs.anthropic.com/" target="_blank" rel="noreferrer">Anthropic Claude API →</a></li>
        <li><a href="https://github.com/arjuncooliitr/prism-appbuilder-agent" target="_blank" rel="noreferrer">PRism on GitHub →</a></li>
      </ul>
    </div>
  </div>
)
