# Prism

**Autonomous AI engineer for Adobe aio open-source repos, built on App Builder.**

Prism watches Adobe's aio repos, uses Claude (via Amazon Bedrock) to triage open issues and draft real fixes, and surfaces them in a React Spectrum dashboard for human review. Every pipeline stage is an I/O Runtime action; the review UI is an App Builder SPA extension; persistence is `aio-lib-state`. The narrative: *"I used App Builder to build an autonomous engineer that improves App Builder itself."*

Built for **AUP AI Week 2026** (Developer Platform India). Live dashboard: [52381-567salmonmarsupial-stage.adobeio-static.net](https://52381-567salmonmarsupial-stage.adobeio-static.net/index.html).  
First autonomous PR: [adobe/aio-lib-events#81](https://github.com/adobe/aio-lib-events/pull/81).

---

## What it does

1. **Polls** a configurable list of aio repos via the GitHub Issues API
2. **Triages** each issue with Claude: assigns a 3-level priority (P1 high / P2 medium / P3 low), a freshness flag (fresh / active / stale), an issue-type (`typo` / `dep-bump` / `bug` / `needs-human`), and a one-sentence rationale
3. **Drafts fixes** for fixable archetypes via a Claude tool-use loop over the GitHub Contents and Trees APIs — no repo cloning, no local filesystem
4. **Opens real draft PRs** on the target repo (direct branch-on-origin; requires maintainer push access)
5. **Waits for human approval** in the dashboard; on approve, flips the draft → ready-for-review via the GitHub GraphQL `markPullRequestReadyForReview` mutation

Nothing merges automatically. Every transition from draft → ready is gated by a click in the review modal.

---

## Architecture

```
┌─────────────────┐    poll (manual)    ┌────────────────────────────────┐
│ aio public repos│ ──────────────────▶ │ App Builder app (I/O Runtime)  │
└─────────────────┘                     │                                │
                                        │  fetch-issues   ──┐            │
                                        │  triage-issue  ◀──┤  Bedrock   │
                                        │  fix-issue     ◀──┤  Claude    │
                                        │     (tool loop:                │
                                        │      list_files,               │
                                        │      read_file,                │
                                        │      propose_edit,             │
                                        │      abort)                    │
                                        │  create-pr     ◀──┤ GitHub API │
                                        │  approve-pr    ◀──┤ (GraphQL)  │
                                        │  notify        ◀──┘ (Slack)    │
                                        └────────┬───────────────────────┘
                                                 │
                                                 ▼
                                        ┌────────────────────────┐
                                        │ React Spectrum         │
                                        │ dashboard (SPA)        │
                                        │  • priority-ranked queue│
                                        │  • diff review modal    │
                                        │  • approve / reject     │
                                        │  • activity timeline    │
                                        └────────────────────────┘
```

## Actions (I/O Runtime)

| Action | Purpose | Notes |
|---|---|---|
| `fetch-issues`  | Pull open issues from `TARGET_REPOS`; merge with existing bot state | Reads default 30 most-recent issues per repo (PRs filtered out) |
| `triage-issue`  | One Bedrock call → priority / freshness / archetype / rationale | Heuristic fallback when no LLM key is configured |
| `fix-issue`     | Claude tool-use loop → staged edits → chained create-pr inline | Runs > 60s, designed around CloudFront sync timeout |
| `create-pr`     | Standalone entry for `createPRFromDraft` helper (manual retries) | Same helper fix-issue calls inline |
| `approve-pr`    | Flip draft PR → ready-for-review via GraphQL; or close on reject | |
| `notify`        | Slack webhook for state transitions | No-ops if `SLACK_WEBHOOK_URL` unset |

## Dashboard

Single-page React Spectrum extension:

- **Sticky top bar** with gradient Prism wordmark + navigation
- **Stats bar** with a segmented progress visualizer (fresh/active/stale breakdown by status)
- **Segmented filter controls** — Repo, Priority, Issue type, Status
- **Priority-coded issue cards** with red / amber / blue stripes, triage-rationale tooltip, inline PR link when one exists, status-aware CTAs
- **PR review modal** — full unified diff with `+`/`-` coloring, "View PR on GitHub" link in the header once a real PR exists, approve / reject / regenerate
- **Activity timeline** — rolling event log with colored dots per event kind, sticky side panel
- **Async orchestration** — CloudFront 504s on long fix-issue calls are swallowed; Dashboard polls state every 8s while any issue is in-flight and shows a "Prism is prisming…" spinner on the card

## Tech stack

| Layer | Choice |
|---|---|
| Platform       | Adobe App Builder + I/O Runtime (nodejs:22)          |
| State store    | `@adobe/aio-lib-state` (KV, TTL 30d per issue)       |
| LLM            | Anthropic Claude Opus 4 via Amazon Bedrock (us-east-1 inference profile) |
| LLM SDK        | `@anthropic-ai/bedrock-sdk` (bearer token or IAM auth) |
| GitHub client  | `@octokit/rest` (Contents + Trees + Git Data + GraphQL) |
| UI             | React 16 + `@adobe/react-spectrum` (accessibility primitives) + custom dark CSS |
| Typography     | Inter (UI), JetBrains Mono (code / numbers)          |

## How the tool-use loop works

`fix-issue` runs up to 10 Claude iterations with four tools:

- `list_files(pattern?)` — returns filtered paths from the pre-fetched repo tree (200-path cap per call)
- `read_file(path)` — cached, size-capped at 200 KB
- `propose_edit(path, new_content, reason)` — stages a file replacement with a reason string
- `abort(reason)` — cleanly abandons with a reason (Claude self-gates when the fix is ambiguous)

Each archetype has its own system prompt:
- **Typo**: find file, verify the typo exists, propose a minimal edit
- **Bug**: abort unless the issue body includes a concrete fix; never guess

After the loop:
- Unified diffs are generated client-side in `actions/common/diff.js` (line-level LCS, context=3)
- Edits are committed in **one atomic commit** via Git Data API (blob → tree → commit → ref update)
- A draft PR is opened; the approve flow later flips it ready

## Running it

**Prereqs:**
- Node 18+, `@adobe/aio-cli` installed globally
- Adobe Developer Console project with a Stage workspace and App Builder service
- GitHub PAT with `repo` scope (maintainer access on every repo in `TARGET_REPOS`)
- Amazon Bedrock account with Claude model access; a long-term Bedrock API key (`ABSKQm…`)

**Setup:**

```bash
git clone https://github.com/arjuncooliitr/prism-appbuilder-agent.git
cd prism-appbuilder-agent
npm install

# Wire up Adobe workspace
aio login
aio console ws select   # pick your Stage workspace

# Secrets
cp .env.example .env
# fill in GITHUB_TOKEN, AWS_BEARER_TOKEN_BEDROCK, TARGET_REPOS, BEDROCK_MODEL_ID

# Deploy
aio app deploy --force-deploy
```

The deploy output prints the dashboard URL. Opening it triggers `fetch-issues`; click **Triage now** on any card to classify with Claude, then **Fix & draft PR** to run the full pipeline.

**Environment variables** (see `.env.example` for full list):

| Var | Purpose |
|---|---|
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope |
| `TARGET_REPOS` | CSV of `owner/repo` to watch |
| `AWS_BEARER_TOKEN_BEDROCK` | Long-term Bedrock API key (preferred) |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | IAM fallback |
| `AWS_REGION` | Defaults to `us-east-1` |
| `BEDROCK_MODEL_ID` | e.g. `us.anthropic.claude-opus-4-20250514-v1:0` |
| `SLACK_WEBHOOK_URL` | Optional Slack notifications |

## Day-by-day progress

**Day 1 — scaffolding + read path**
- `aio app init` scaffold + React Spectrum template
- 6 actions wired up with Day-1 stubs for fix/create-pr
- Dashboard renders real issues end-to-end; triage had a heuristic fallback so no LLM spend required

**Day 2 — write path + real Claude**
- Switched from Anthropic direct API → Amazon Bedrock (`@anthropic-ai/bedrock-sdk`)
- Built Claude tool-use loop with four tools scoped to a single repo
- Real `fix-issue` for typo + bug archetypes with per-archetype system prompts
- Real `create-pr`: atomic Git Data API commit + draft PR on origin
- Real `approve-pr`: GraphQL `markPullRequestReadyForReview`
- UI: custom diff renderer with `+`/`-` coloring, segmented priority filter, "View on GitHub" PR link, async pending state with polling
- First autonomous PR shipped: [adobe/aio-lib-events#81](https://github.com/adobe/aio-lib-events/pull/81) — fixes the CloudEvents specversion e2e bug with a minimal, surgical diff

**Day 3 — planned**
- Real dep-bump archetype (deterministic npm registry lookup)
- Merge watcher → `merged` status reflected in dashboard
- Slack notifications on state transitions
- Optional: hybrid fork-fallback for repos without maintainer access (e.g. aio-theme)

## Known limits

- **CloudFront 60s sync timeout**: real fix-issue calls almost always exceed this; Dashboard absorbs 504s and polls state (intentional). Direct `curl` / `aio rt action invoke` hit the same limit; use the activation ID to fetch async results.
- **Repo tree cap**: Git Trees API returns truncated lists for very large monorepos. Prism logs a warning; Claude may miss files outside the first page. Not a problem for any aio repo today.
- **Single-repo scope per fix**: the tool-use loop is bound to one `owner/repo`. Cross-repo fixes (e.g. bumping a shared dep) are out of scope.
- **Bedrock inference profiles**: Opus 4.5 / 4.6 / 4.7 exist in the foundation-model catalog but require custom inference profiles or provisioned throughput for on-demand invocation. Prism defaults to Opus 4, which ships with a `us.` regional inference profile.

## Repo layout

```
prism/
├── actions/
│   ├── common/
│   │   ├── github.js      (read + write helpers)
│   │   ├── claude.js      (Bedrock client + prompt caching)
│   │   ├── claude-tools.js (tool-use loop)
│   │   ├── state.js       (aio-lib-state wrapper)
│   │   ├── pr.js          (shared PR-creation helper)
│   │   └── diff.js        (LCS-based unified diff)
│   ├── fetch-issues/ triage-issue/ fix-issue/
│   ├── create-pr/ approve-pr/ notify/
│   └── utils.js
├── web-src/
│   └── src/components/
│       ├── App.js            (shell + top bar)
│       ├── Dashboard.jsx     (orchestration + polling loop)
│       ├── IssueCard.jsx     (priority-striped card)
│       ├── FilterBar.jsx     (segmented controls)
│       ├── StatsStrip.jsx    (progress bar + legend)
│       ├── PRReviewModal.jsx (diff view + GitHub link)
│       ├── ActivityFeed.jsx  (timeline)
│       └── About.js
├── app.config.yaml
├── .env.example
└── README.md
```

## License

Apache-2.0.
