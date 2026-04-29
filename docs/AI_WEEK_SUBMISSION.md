# Prism — agentic dashboard for Adobe open-source repos

**AUP AI Week 2026 · Developer Platform India · Arjun Gupta**

---

## TL;DR

Prism is an autonomous AI agent that watches Adobe's `aio` open-source repositories, triages every open issue with **Claude Opus on Amazon Bedrock**, and drafts real fix PRs that humans approve in a React Spectrum dashboard. The entire system runs on **App Builder** — meaning the same platform we ship to customers now powers an agent that improves App Builder's own OSS ecosystem.

Built end-to-end during AI Week. Two real PRs already live on `adobe/aio-lib-events` ([#82](https://github.com/adobe/aio-lib-events/pull/82) and [#83](https://github.com/adobe/aio-lib-events/pull/83)).

---

## Why this matters

Across `aio-cli`, `aio-cli-plugin-app`, `aio-lib-events`, and the broader aio repo family, hundreds of open issues sit at any given time — typos, broken links, stale dependency versions, small bugs with the fix already specified in the issue body. Maintainers fix these between higher-value work, but each one costs a context switch. It's classic toil — high-volume, low-skill, never urgent enough to prioritize.

Prism closes that loop. The agent triages every issue with priority, freshness, and type; drafts fixes for the ones it can handle confidently; and routes everything else (with a specific reason) back to a human. Maintainer time gets reclaimed for work that actually requires judgment.

The strategic dimension matters more than the specific outcome. Prism is a **reference implementation** of the pattern *App Builder + Bedrock + GitHub API tool-use*. Any Adobe team with a public repo, Jira backlog, or ServiceNow ingress could fork it and stand up their own triage-and-act agent in under a week.

---

## Live artifacts

| | Link |
|---|---|
| 🟢 **Live dashboard** (open to anyone in the org) | https://52381-567salmonmarsupial-stage.adobeio-static.net/index.html |
| 🟢 **Source repo** (full architecture writeup in README) | https://github.com/arjuncooliitr/prism-appbuilder-agent |
| 🟢 **Live PR #82** — CloudEvents specversion bug · Claude tool-use loop · 5 autonomous CI iterations | https://github.com/adobe/aio-lib-events/pull/82 |
| 🟢 **Live PR #83** — broken rxjs URL replaced across 3 files · deterministic, 10 seconds, zero LLM tokens for the fix | https://github.com/adobe/aio-lib-events/pull/83 |
| 📄 **Full reflection** (with honest failures) | https://github.com/arjuncooliitr/prism-appbuilder-agent/blob/master/REFLECTION.md |
| 📹 **2-min walkthrough demo** | *(attach video)* |

---

## What it does

1. **Polls** configured aio repos via the GitHub Issues API on every dashboard refresh
2. **Triages** each issue with one Claude call → priority (P1/P2/P3), freshness (fresh/active/stale), type (typo/dep-bump/bug/needs-human), one-sentence rationale
3. **Drafts fixes** via deterministic-first / Claude-fallback routing:
    - **Typo** → regex-extract `(old, new)` pair from the issue body, grep the repo, rewrite files, commit. ~10 seconds, zero LLM call for the fix.
    - **Dep-bump** → parse `package.json`, query npm registry, rewrite versions preserving caret/tilde ranges. Deterministic.
    - **Bug** → Claude tool-use loop (`list_files`, `search_content`, `read_file`, `propose_edit`, `abort`) scoped to one repo
4. **Opens real draft PRs** on origin (not forks — Prism currently has admin push access to the watched repos)
5. **Iterates on feedback** when CI fails or reviewers comment — pulls workflow logs, runs Claude with a revision-mode prompt that prioritizes red CI over proactive improvements, additively commits to the same branch, and posts a summary comment on the PR per iteration
6. **Waits for human approval** in the dashboard. Approve → flips draft → ready-for-review via GitHub GraphQL. Nothing merges automatically.

---

## How it works (architecture)

```
┌──────────────────┐    poll      ┌───────────────────────────────────┐
│ aio public repos │ ──────────▶  │ App Builder app (I/O Runtime)     │
└──────────────────┘              │                                   │
                                  │  fetch-issues   ──┐               │
                                  │  triage-issue  ◀──┤  Bedrock      │
                                  │  fix-issue     ◀──┤  Claude Opus  │
                                  │     (deterministic OR tool-use)   │
                                  │  create-pr     ◀──┤  GitHub API   │
                                  │  refix-pr      ◀──┤  (GraphQL)    │
                                  │  approve-pr    ◀──┤               │
                                  │  settings      ◀──┤  aio-lib-state│
                                  └─────────┬─────────────────────────┘
                                            │
                                            ▼
                                  ┌────────────────────────┐
                                  │ React Spectrum         │
                                  │ dashboard (App Builder │
                                  │ UI extension)          │
                                  └────────────────────────┘
```

**Stack:**

| Layer | Choice |
|---|---|
| Platform | Adobe App Builder + I/O Runtime (Node 22) |
| State | `@adobe/aio-lib-state` (KV with TTL) |
| Reasoning | Claude Opus 4 via Amazon Bedrock (us-east-1 inference profile) |
| LLM SDK | `@anthropic-ai/bedrock-sdk` |
| GitHub | `@octokit/rest` (Issues + Contents + Trees + Git Data + GraphQL + Actions logs) |
| UI | React + `@adobe/react-spectrum` + custom themed CSS (dark/light toggle) |

**7 I/O Runtime actions:** `fetch-issues`, `triage-issue`, `fix-issue`, `create-pr`, `refix-pr`, `approve-pr`, `settings`.

---

## What's genuinely novel

Three patterns worth extracting for other Adobe teams:

1. **Deterministic-first routing.** For task shapes that have a clean mechanical solution (find-and-replace, version bumps), bypass the agent entirely and use ~100 lines of code that runs in seconds. Reserve Claude for genuinely unstructured cases. This single design choice was the most important lesson of the week.
2. **Tool-call safety layer.** A small `normalizeEdit` helper that (a) preserves trailing newlines the LLM drops mid-serialization, and (b) rejects byte-identical proposals before they reach the commit layer. Catches a whole class of silent LLM failures that prompt engineering alone cannot prevent.
3. **Abort-with-reason as product signal.** Every skipped issue carries a Claude-authored explanation that the dashboard surfaces as an amber panel on the card. When three skips in a row pointed at "fix lives in `aio-cli-plugin-app`", that's structured config evidence — *the agent told me which plugin repos to add to the watch list*. Discipline is the feature.

---

## What worked, honestly

- **Two real shipped PRs** on a real Adobe public repo, with CI passing on the iterated one
- **Deterministic-first** turned the week's biggest dead-end (issue #32, 90 min of failed Claude attempts) into a 10-second auto-fix
- **CI-log-aware iteration** — pulling GitHub Actions workflow logs (since `check.output.text` is almost always empty) made refix actually work
- **Architectural framing** — when asked "how do we iterate on a PR after CI fails?", Claude produced the Tier 1 / Tier 2 / Tier 3 framework (manual button → auto-polling → webhooks) unprompted, with correct tradeoff analysis
- **Graceful abort** — Claude refused to push code when it detected an issue belonged to a different repo, asking a clarifying question instead. That's enterprise-grade discipline most demos hide.

## What didn't work, also honestly

- **The "describe-instead-of-execute" trap** cost ~8 hours: Claude narrated plans without calling the tools, and stricter prompts made it more cautious not more decisive. Drove the deterministic-first design.
- **Opus 4.7 was inaccessible on-demand** — the Bedrock catalog showed access but every call returned `AccessDeniedException`. Required custom inference profiles or provisioned throughput. Settled on Opus 4.
- **CloudFront's 60s sync timeout** — every interactive `fix-issue` call 504s the client while the action keeps running backend-side. Dashboard polls to compensate; cleaner async would need webhooks.
- **dep-bump archetype is unshipped to live** — the code works, unit tests pass, but every open bump on the watched repos is a Dependabot *PR* (which the bot correctly filters out). Pipeline runs the moment a human-filed bump issue appears.

Full failure-mode writeup with diagnostics in [REFLECTION.md](https://github.com/arjuncooliitr/prism-appbuilder-agent/blob/master/REFLECTION.md).

---

## Strategic value

For Developer Platform's argument that **App Builder is the right platform to build AI agents on**, Prism is a working, live, unambiguous proof point rather than a slide. It demonstrates:

- App Builder's I/O Runtime actions composed into an autonomous agent
- React Spectrum UI extensions for the human-in-the-loop layer
- `aio-lib-state` for persistent agent memory + configuration
- Bedrock as the reasoning substrate (not Anthropic API direct — a deliberate enterprise choice)
- GitHub API tool-use as the action surface (the same pattern would work with Jira, ServiceNow, internal Adobe APIs)

The pattern generalizes. Any team can fork the skeleton, swap the GitHub API tools for their domain's APIs, and ship a triage-and-act agent in under a week.

---

## What I learned this week (one-liner)

> *Pick the right tool for the shape of the problem before reaching for an agent. Agents are the fallback, not the default. Every irreversible action gets a mechanical safety layer between the LLM's output and the real world — no prompt alone is a reliable safety mechanism.*

---

## Author

Built by **Arjun Gupta** · Developer Platform India · Adobe App Builder team
[GitHub: arjuncooliitr](https://github.com/arjuncooliitr) · arjung@adobe.com

Happy to pair with any team that wants to build their own version. The pattern (App Builder + Bedrock + tool-use) generalizes — any team with a public repo, Jira board, or ServiceNow ingress point could fork this in under a week.

---

## Try it

1. Visit the [live dashboard](https://52381-567salmonmarsupial-stage.adobeio-static.net/index.html)
2. Click "Triage now" on any new issue → watch Claude classify it in 2-3 seconds
3. Click "Review PR" on issue #80 (or #32) → see the diff Prism shipped to GitHub
4. Open the [GitHub PRs](https://github.com/adobe/aio-lib-events/pulls?q=is%3Apr+author%3Aarjuncooliitr+%5BPrism%5D) directly to see the comment threads from autonomous iterations
5. Read the [full reflection](https://github.com/arjuncooliitr/prism-appbuilder-agent/blob/master/REFLECTION.md) for the unvarnished story including dead-ends

---

## Follow-up work (post-AI-Week)

| Item | Status |
|---|---|
| Tier 3 — GitHub webhooks → I/O Events → fully autonomous iteration without human button click | Designed, not shipped |
| dep-bump archetype tested on a live human-filed issue | Code ready, waiting for a real test target |
| Adobe-native UI overhaul (full React Spectrum component swap, light-mode default, Experience Cloud shell integration) | Path B Lite shipped (Source Sans 3, indigo palette); full Path A is post-AI-Week |
| Auto-detect new PR feedback on a polling cadence (Tier 2) | Designed, not shipped |
| Recommend new watched repos from skip-reasons | Possible follow-up — three skips already pointed at `aio-cli-plugin-app` |
