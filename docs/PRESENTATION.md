# Prism — wider-forum presentation deck

**Format:** 3 slides + live demo · ~8-10 min total
**Audience:** mixed (engineering + leadership + cross-discipline)
**Author:** Arjun Gupta · Developer Platform India · AI Week 2026

---

## Suggested running order

```
[Slide 1]  →  Live demo (3-5 min)  →  [Slide 2]  →  [Slide 3]
   1 min          show, don't tell        1.5 min      1.5 min
```

This puts the demo where the audience's attention peaks and the slides as bookends — context first, reflection last. The demo *is* the proof.

---

# Slide 1 — The problem and the bet

**Title bar:** *Prism — Autonomous agentic dashboard for Adobe aio open-source maintenance*

**Subtitle / one-liner:** *Built on App Builder, to improve App Builder's own OSS ecosystem.*

**Visual:** screenshot of the dashboard (issue queue with priority chips, the Adobe logo top bar, the "Skipped by Prism" amber panel visible). Take it in dark mode — more screen presence.

**Three callout panels (left to right):**

| The problem | The bet | The artifact |
|---|---|---|
| 75+ open issues at any time across aio repos | Autonomous AI agent that triages every issue + drafts real fix PRs | 2 live PRs shipped on `adobe/aio-lib-events` this week |
| Typos · stale deps · bugs with the fix in the body | App Builder + Claude Opus on Amazon Bedrock + GitHub API tool-use | End-to-end working — not a slide |
| Maintainer time fragmented between toil and high-value work | Human-in-the-loop approval on every PR | Pattern is forkable for any team |

**Speaker notes (~60s):**
> "Adobe's aio open-source repos accumulate 75+ open issues at any time. A large slice of those is high-volume, low-skill toil — typos, stale dep versions, small bugs where the fix is already in the issue body. Maintainers fix them between higher-value work, but each one costs a context switch.
>
> Prism is an autonomous agent that watches these repos, triages every issue with Claude, and drafts real fix PRs — all gated by human approval in a dashboard. It runs entirely on App Builder. The same platform we ship to customers now powers an agent that improves App Builder's own open-source ecosystem.
>
> Two real PRs already live on `adobe/aio-lib-events`. Let me show you."

→ **transition to live demo**

---

# Live demo (3-5 min)

Mid-presentation demo flow — this is *the* artifact, lean into it:

1. **Open dashboard** (10s) — top bar, Adobe logo, queue
2. **Triage live** (20s) — click "Triage now" on a fresh issue, watch Claude classify with priority + rationale
3. **Hero 1: deterministic typo (60s)** — issue #32 → Review PR → diff → switch to GitHub PR #83 → *"10 seconds, zero LLM tokens for the fix itself"*
4. **Hero 2: Claude tool-use + iteration (90s)** — issue #80 → ↻5 badge → switch to GitHub PR #82 → show the comment thread of autonomous iterations → CI green
5. **Skip with reason (30s)** — show #774's amber "Skipped by Prism: fix lives in `aio-cli-plugin-app`" panel → *"Discipline is a feature. The agent told me which plugin repos to add to the watch list."*

Have the dashboard tab and both GitHub PR tabs open before you start. Pre-warm the actions.

---

# Slide 2 — What worked, what didn't (honest)

**Title:** *Half the week was wins. Half was honest dead-ends.*

**Visual:** two columns — green tint left, amber/red tint right. Equal weight on purpose. The honest split is the message.

### ✅ What worked

- **Deterministic-first routing** turned the week's biggest dead-end into the cleanest pattern. Issue #32 went from *"90 min, 0 PRs"* to *"10 sec, 1 PR shipped"* once I bypassed Claude for find-and-replace.
- **CI-log-aware iteration.** GitHub Actions checks return empty `output.text`; the real failure lives in workflow run logs at a separate endpoint. Pulling those into Claude's context made refix actually work.
- **Abort-with-reason as product signal.** Three skips in a row pointed at `aio-cli-plugin-app` — the agent literally told me which plugin repos to add to the watch list.
- **Architectural framing was a strength.** Claude produced the Tier 1/2/3 PR-iteration framework unprompted, with correct tradeoff analysis. Senior-engineer-level product thinking.

### ⚠️ What didn't

- **"Describe-instead-of-execute" trap.** Claude narrated plans without calling the tools — 15 iterations, 90 minutes, zero PRs on issue #32. Tightening the prompt made it slower, not more decisive.
- **Bedrock model availability theater.** Opus 4.7 was "accessible" in my catalog but every on-demand call returned `AccessDeniedException` — required custom inference profiles. Settled on Opus 4.
- **CloudFront's 60s sync timeout** fights long Claude runs. Had to design polling and 504-tolerance into the dashboard from scratch.
- **Whitespace sloppiness.** Claude dropped trailing newlines mid-JSON-serialization. Required mechanical safety rails — *not* prompt engineering.

**Speaker notes (~90s):**
> "Half my week was honest dead-ends. The biggest pattern out of the failures: prompt engineering isn't a reliable safety mechanism. When Claude kept describing fix plans without actually calling the tools, no amount of 'just call the tool!' in the system prompt changed it. What worked was a mechanical safety layer — small bits of code between the LLM's output and the irreversible action.
>
> Same theme behind the deterministic-first design. Pure find-and-replace shouldn't use an agent at all. A 130-line regex+grep helper produced the PR Claude couldn't ship in 90 minutes — in 10 seconds.
>
> The skips are also worth dwelling on. When Claude realized one issue was about code in a different repo, it aborted with a question instead of pushing a wrong fix. That's the discipline enterprise agents need but most demos hide. Surfacing those skip reasons in the UI turned a failure signal into structured product information."

---

# Slide 3 — Key learnings + what's next

**Title:** *Five rules I'll carry into every future agent project*

**Visual:** large pull-quote at the top, then a 5-row "do / don't" table, then a small "next" section at the bottom.

### Pull-quote (large, top of slide)

> *"Pick the right tool for the shape of the problem before reaching for an agent. Agents are the fallback, not the default."*

### Do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Use deterministic code for tasks with clean mechanical solutions | Trust prompt engineering as a safety mechanism for strong LLM reflexes |
| Put a mechanical safety layer between LLM output and irreversible actions | Skip the abort tool — "I don't know" is a feature |
| Surface the agent's reasoning as product UX (skip reasons, iteration history) | Hide failure modes from users — they're config signal |
| Give agents fewer tools with stricter contracts than they ask for | Make the tool-use loop unbounded — always cap iterations |
| Verify the LLM's "access" layer separately from the "capability" layer (Bedrock infra ≠ Anthropic capability) | Assume model-listed-as-accessible means model-invocable on demand |

### What's next

- **Continuing** — Tier 3 GitHub webhooks for fully autonomous iteration on PR feedback (current is manual button-click)
- **Continuing** — `dep-bump` archetype tested on a live human-filed issue when one appears (code is shipped, test target isn't)
- **Open question** — package the App Builder + Bedrock + tool-use pattern as a fork-able template for other Adobe teams. *That's the bigger win than Prism itself.*

**Speaker notes (~75s):**
> "The five rules at the top are a year of agent-building wisdom compressed into a week of pain. The biggest one — *pick the right tool for the shape of the problem* — is the lesson I'd give my Day-1 self. Pure find-and-replace doesn't need an agent. Most version-bump tasks don't need an agent. Save the LLM for the genuinely unstructured cases.
>
> Going forward, I'm continuing on Prism. The next pieces are autonomous webhook-driven iteration and the dep-bump archetype on a real test target. But the real strategic question — *can we package this pattern so any team in Developer Platform can stand up their own triage-and-act agent in a day* — is what I'd actually want feedback on from this room. The pattern matters more than the specific tool."

---

## Visual treatment guidance

If you're building this in Keynote / Google Slides / PowerPoint:

- **Color palette** — match Adobe Spectrum: indigo `#5258E4` for accent, Adobe red `#eb1000` only for the small Prism logo, no other reds. Backgrounds: white or `#f8f8fb`. Text: `#1a1a22`.
- **Typography** — Adobe Clean (or Source Sans 3 if Adobe Clean isn't installed). Mono for code: Source Code Pro.
- **Density** — slides should be readable from 30 ft. No font smaller than 18 pt. Each slide should communicate even if you're silent.
- **Screenshots** — take in dark mode (more screen presence). Crop tight.
- **Avoid** — bullet salad, gradient backgrounds, drop shadows, stock photos, the word "AI-powered" anywhere.

## Backup slides (if Q&A goes deep)

Keep these in your back pocket; only pull if asked:

- **Architecture diagram** (the ASCII one from REFLECTION.md, redrawn cleanly) — for the "how does it work technically?" question
- **Cost numbers** — Bedrock Opus 4 + prompt caching: ~$2 to triage 100 issues; ~$8-15 per Claude tool-use loop fix. Cheap enough to never be the bottleneck.
- **Code surface** — 7 I/O Runtime actions, ~4500 LOC, 1 React Spectrum SPA. ~3 days of focused work after the Bedrock pivot.
- **The skip story in detail** — the three plugin-repo skips that turned into a config recommendation. Demonstrates the "agent telling you how to configure itself" insight.

## Common questions to anticipate

| Q | Short answer |
|---|---|
| Why not GitHub Copilot Workspace / Claude Code Action / Cursor? | Those are dev-environment agents. Prism is a *production agent* on shared infrastructure with state, audit trail, and human approval gating. Different category. |
| What about cost at scale? | Bedrock Opus is ~3¢ per typical fix loop. At Adobe-internal volume, the bottleneck is review time, not LLM cost. |
| What if Prism opens a wrong PR? | It's draft-only by design. Human approves in the dashboard before it goes ready-for-review. Nothing merges automatically. Skip-with-reason catches most "wrong" cases at triage. |
| Could this work for Jira / ServiceNow / internal Adobe APIs? | Yes — that's the pattern argument. Swap the GitHub API tools for the new domain's tools; the agent loop stays the same. |
| Why App Builder vs. running it on AWS Lambda directly? | Adobe's developer tooling, identity, deployment, and observability are already there. Same reason any internal Adobe project picks App Builder. The meta-narrative also matters. |

---

## Links to embed (footer of every slide)

- 🟢 Live: `52381-567salmonmarsupial-stage.adobeio-static.net`
- 📦 Source: `github.com/arjuncooliitr/prism-appbuilder-agent`
- 📄 Full reflection: `…/REFLECTION.md` (with all dead-ends)
