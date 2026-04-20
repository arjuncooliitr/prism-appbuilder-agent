# PRism

**Autonomous AI engineer for Adobe aio public repos, built on App Builder.**

PRism watches configured aio repos, uses Claude to triage open issues (priority, freshness, archetype), drafts fixes as draft PRs, and surfaces them in a React Spectrum dashboard for human approval. The narrative: _"I used App Builder to build the autonomous engineer that improves App Builder itself."_

Built for **AUP AI Week 2026** (Developer Platform India).

---

## Architecture

```
┌─────────────┐   poll (10m)       ┌──────────────────────────────┐
│ aio repo(s) │ ─────────────────▶ │ App Builder app (I/O Runtime)│
└─────────────┘                    │                              │
                                   │  fetch-issues  ──┐           │
                                   │  triage-issue ◀──┤ Claude    │
                                   │  fix-issue    ◀──┤ Opus 4.6  │
                                   │  create-pr    ◀──┤           │
                                   │  notify       ◀──┘           │
                                   └──────────┬───────────────────┘
                                              │
                                              ▼
                                   ┌─────────────────────────┐
                                   │ React Spectrum dashboard│
                                   │  • priority-ranked queue│
                                   │  • diff review modal    │
                                   │  • approve / reject     │
                                   └─────────────────────────┘
```

## Actions (I/O Runtime)

| Action          | Purpose                                                 |
|-----------------|---------------------------------------------------------|
| `fetch-issues`  | Pull open issues from `TARGET_REPOS` and persist state  |
| `triage-issue`  | Claude-scored priority / freshness / archetype          |
| `fix-issue`     | Generate a draft fix for a triaged issue (Day 2+)       |
| `create-pr`     | Open a draft PR on GitHub                               |
| `approve-pr`    | Flip draft → ready-for-review after human approval      |
| `notify`        | Post state transitions to Slack                         |

## Dashboard (`web-src/`)

Single-page React Spectrum extension with:

- `StatsStrip` — queue counts by status
- `IssueTable` — sortable by composite (priority × freshness), row-level CTAs
- `PRReviewModal` — diff preview with approve / reject
- `ActivityFeed` — rolling event log

## Day-by-day plan

- **Day 1** — Scaffold, `fetch-issues` live, dashboard renders real issues (stub triage/fix)
- **Day 2** — Wire Claude for real triage; first archetype (typo) end-to-end
- **Day 3** — Real `create-pr` + `approve-pr` via GitHub API; dep-bump archetype
- **Day 4** — Bug-fix archetype with test generation; Slack; polish
- **Day 5** — Dogfood on 5–10 real issues; record demo; write reflection

## Setup

```bash
# Install deps
npm install

# Configure environment
cp .env.example .env
# Fill in GITHUB_TOKEN, TARGET_REPOS, ANTHROPIC_API_KEY (optional for Day 1)

# Select Adobe Developer Console workspace
aio login
aio console ws select

# Deploy & run
aio app deploy
aio app dev   # local dev mode
```

Dashboard renders at the Runtime `index.html` URL reported by `aio app deploy`.

## Running without an Anthropic key (Day 1)

If `ANTHROPIC_API_KEY` is empty, `triage-issue` falls back to a heuristic stub
(labels + title keywords + age). The rest of the pipeline works end-to-end so
the dashboard, review flow, and state transitions can be demoed immediately.

## License

Apache-2.0 (see scaffolded defaults).
