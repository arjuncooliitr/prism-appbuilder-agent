/*
 * PRReviewModal — shown when a reviewer clicks "Review PR" on an awaiting-review row.
 * Day 1: renders the draft payload from fix-issue. Day 3 will render a real unified diff.
 */

import React from 'react'
import PropTypes from 'prop-types'
import {
  Dialog,
  DialogContainer,
  Heading,
  Divider,
  Content,
  Footer,
  ButtonGroup,
  Button,
  Text,
  Flex,
  View
} from '@adobe/react-spectrum'

const PRReviewModal = ({ issue, onClose, onApprove, onReject }) => {
  return (
    <DialogContainer onDismiss={onClose} type="fullscreenTakeover">
      {issue && (
        <Dialog>
          <Heading>{`Review draft PR — ${issue.repo}#${issue.number}`}</Heading>
          <Divider />
          <Content>
            <Flex direction="column" gap="size-200">
              <View>
                <Text UNSAFE_style={{ fontWeight: 'bold' }}>Issue</Text>
                <div>
                  <a href={issue.html_url} target="_blank" rel="noreferrer">{issue.title}</a>
                </div>
              </View>

              {issue.triage && (
                <View>
                  <Text UNSAFE_style={{ fontWeight: 'bold' }}>Triage</Text>
                  <div>
                    P{issue.triage.priority} · {issue.triage.freshness} · {issue.triage.archetype}
                  </div>
                  <div style={{ color: 'var(--spectrum-global-color-gray-700)' }}>
                    {issue.triage.rationale}
                  </div>
                </View>
              )}

              {issue.draft ? (
                <>
                  <View>
                    <Text UNSAFE_style={{ fontWeight: 'bold' }}>Proposed title</Text>
                    <div>{issue.draft.title}</div>
                  </View>
                  <View>
                    <Text UNSAFE_style={{ fontWeight: 'bold' }}>Branch</Text>
                    <div><code>{issue.draft.branch}</code></div>
                  </View>
                  <View>
                    <Text UNSAFE_style={{ fontWeight: 'bold' }}>PR body</Text>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--spectrum-global-color-gray-100)',
                      padding: '12px',
                      borderRadius: '4px'
                    }}>{issue.draft.body}</pre>
                  </View>
                  <View>
                    <Text UNSAFE_style={{ fontWeight: 'bold' }}>Diff</Text>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--spectrum-global-color-gray-100)',
                      padding: '12px',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      fontSize: '12px'
                    }}>{issue.draft.diff}</pre>
                  </View>
                </>
              ) : (
                <Text>No draft available yet. Run "Fix & draft PR" first.</Text>
              )}
            </Flex>
          </Content>
          <Footer>
            <ButtonGroup>
              <Button variant="secondary" onPress={onClose}>Close</Button>
              <Button variant="negative" onPress={() => onReject(issue)}>Reject</Button>
              <Button variant="cta" onPress={() => onApprove(issue)} isDisabled={!issue.draft}>
                Approve & mark ready
              </Button>
            </ButtonGroup>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}

PRReviewModal.propTypes = {
  issue: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onApprove: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired
}

export default PRReviewModal
