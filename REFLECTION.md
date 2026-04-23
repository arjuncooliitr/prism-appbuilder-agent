# AUP AI Week 2026 — Reflection

**Participant:** Arjun Gupta · Developer Platform India (App Builder)
**Project:** Prism — autonomous issue-to-PR agent, built on App Builder
**Repo:** [github.com/arjuncooliitr/prism-appbuilder-agent](https://github.com/arjuncooliitr/prism-appbuilder-agent)
**Dashboard:** [52381-567salmonmarsupial-stage.adobeio-static.net](https://52381-567salmonmarsupial-stage.adobeio-static.net/index.html)
**Live PR:** [adobe/aio-lib-events#82](https://github.com/adobe/aio-lib-events/pull/82)

> This is a working draft for the May 1 reflection form. Scale answers are placeholders for personal calibration; the substance is real and specific.

---

## What You Worked On

### 1. Before this week, how comfortable were you using AI tools? (1–7)

**[ 5 / 7 ]** — regular Claude Code user for day-to-day engineering, built AI-assisted side projects (Cruxer), comfortable with prompt engineering and agent patterns. Limited experience wiring LLMs into production backend systems beyond chat interfaces.

### 2. Seeded Challenge, Broad Theme, or Bring Your Own?

**Bring Your Own** — but the project maps cleanly to two Seeded Challenges (**AI Agent Service Layer**, **DevOps Toil Reduction**) and two Broad Themes (**Reimagining Workflow**, **Eliminating Toil**).

### 3. Seeded Challenge(s) it maps to

- **AI Agent Service Layer** — I/O Runtime actions exposed as a composable agent surface; App Builder as the substrate for AI agents. Prism is the reference implementation.
- **DevOps Toil Reduction** — aio repo maintainers lose hours a week to typo PRs, stale dep bumps, and simple lint failures. Prism closes that loop autonomously with human approval.

### 4. Broad Theme(s) it maps to

- **Reimagining Workflow** — shifted from "Claude helps me code" to "Claude executes; I architect and course-correct."
- **Eliminating Toil** — reduced "review this 1-line doc typo PR" from a 10-minute maintainer context switch to a 30-second click.

### 5. What I built / explored

**Problem:** Adobe's aio public repos (aio-cli, aio-cli-plugin-app, aio-cli-plugin-runtime, aio-lib-events, and ~20 others) accumulate 200+ open issues on any given day. A large fraction are low-complexity, high-volume toil — typos, stale dependency versions, small bugs where the fix is already spelled out in the issue body. Fixing them is unrewarding work that distracts maintainers from higher-value work.

**Approach:** Build Prism — an autonomous AI engineer, *using App Builder itself as the platform*, so that the same product this team ships is what gets improved by the agent. Explicit narrative: *"I used App Builder to build the autonomous engineer that improves App Builder."*

Five components:

1. **fetch-issues** — polls configured repos via Octokit; merges with existing bot state via `aio-lib-state` (keys and values constrained to specific regexes I discovered the hard way)
2. **triage-issue** — one Bedrock Claude Opus 4 call classifies priority (P1 high / P2 medium / P3 low), freshness (fresh / active / stale), issue-type (typo / dep-bump / bug / needs-human), and emits a one-sentence rationale. Heuristic fallback when the LLM key isn't available, so Day-1 demos work with zero spend.
3. **fix-issue** — Claude tool-use loop with four tools (`list_files`, `read_file`, `propose_edit`, `abort`) scoped to one repo. Reads files via GitHub Contents API, proposes full-file replacements, commits atomically via Git Data API — no repo cloning, no local filesystem.
4. **create-pr** — commits to origin branch (no fork; I had admin access on 4/5 target repos), opens a draft PR.
5. **refix-pr** — the feedback loop. Pulls review comments, PR discussion, failing CI checks *with raw job logs from `/actions/jobs/{id}/logs`*, feeds them back to Claude in a revision-mode system prompt that strictly prioritizes red CI, additively commits (no force-push), posts a summary comment on the PR.

Plus a dark-themed React Spectrum dashboard with a priority-sorted card queue, segmented filter controls, stats progress bar, live PR links, and a diff review modal with `+`/`-` syntax highlighting.

**Outcome:**
- 5 days, ~3000 LOC across 16 files, 15+ commits on master
- Live draft PR on [adobe/aio-lib-events#82](https://github.com/adobe/aio-lib-events/pull/82) — a real fix for a real CI bug (CloudEvents `specversion` field) that **Prism diagnosed, wrote, and then iterated on its own** when the first attempt introduced an ESLint failure
- On the final commit (`8e47d1d`), all 3 Ubuntu CI jobs went **green** — end-to-end proof that autonomous iteration works
- Reusable pattern: App Builder + Bedrock + GitHub API tool-use is now a template anyone on Developer Platform can fork for their own triage-and-act agents

**Time spent:**
- ~3 hours Day 1 (scaffold + fetch + dashboard skeleton)
- ~6 hours Day 2 (Bedrock pivot, real fix-issue + create-pr, diff renderer)
- ~2 hours Day 3 morning (refix-pr + Tier 1 feedback loop)
- ~2 hours debugging a cascade of subtle bugs that made refix-pr misbehave (see "What shifted / Where AI fell short" below — the most instructive part of the week)

### 6. How did I work?

**Solo, with Claude as the executor.** I spent the week as an architect and code reviewer; Claude wrote nearly all of the code. I course-corrected through natural language ("this row looks cluttered" → Claude redesigned the stats strip; "why is re-fix not picking up the CI failure?" → Claude traced it to a missing log-fetch and fixed three layers of the stack). A more accurate model is *pair programming where the junior pair is fast, tireless, and occasionally very wrong in confident-sounding ways.*

---

## What Changed

### 1. Before this week, default approach to AI (1–7, not-AI-first → extremely-AI-first)

**[ 5 / 7 ]** — AI-assisted but not AI-first. I'd reach for Claude for scaffolds, refactors, "explain this regex" — but the architecture, debugging, and integration work I drove manually.

### 2. What actually shifted about how I approached this problem

**Role inversion.** Instead of "I architect, Claude helps with snippets," the pattern became "I hand off a 3-5-sentence task description, Claude produces a full working artifact, I review and correct." The artifact at end-of-Day-1 was a ~20-file React Spectrum + Node.js backend with 6 serverless actions — I wrote almost none of the keystrokes myself.

**Concretely different:**
- **Speed collapse for infrastructure work.** Scaffolding a 5-action App Builder app with GitHub API helpers, state persistence, React Spectrum dashboard, and deploy config would have been 2 days of manual work. Claude did it in 90 minutes of guided conversation.
- **Debugging became a dialogue.** When `fix-issue` timed out with a 504, I asked "is the action dead?" and Claude checked the activation logs, traced that CloudFront has a 60-second sync window, and redesigned the Dashboard's polling loop to tolerate async completion. I'd have taken 20 minutes to find that myself; it surfaced in 3.
- **I stopped writing code. I started writing specs.** "Tighten the refix system prompt to prioritize red CI over proactive improvements." "Make normalizeEdit always append a trailing newline." The abstraction level I operated at rose visibly across the week.
- **Verification became the bottleneck.** When Claude commits something, it takes ~15 seconds. Verifying it does the right thing — reading the diff, checking state, running the live action, confirming CI turns green — takes 10 minutes. The center of my work shifted from *producing* to *validating*.

### 3. Where AI fell short, slow me down, or surprise me

Honestly mixed — some brilliant, some genuinely worrying. Specific moments:

**Fell short / slowed me down:**

- **LLM whitespace sloppiness.** Claude proposed a file edit that was supposed to fix an `eol-last` ESLint rule by adding a trailing `\n`. The `new_content` string Claude emitted was byte-identical to the original — the newline it "added" was silently dropped during JSON serialization. My noop guard then correctly rejected the edit, and Claude spent three loop iterations saying *"It seems the tool is not detecting my newline addition"* without realizing its own output was the problem. Cost: ~45 min of diagnosis. Fix: add a mechanical guard in `normalizeEdit` that unconditionally appends `\n` on non-empty content, regardless of what Claude sent. **Lesson:** LLMs need mechanical safety rails for anything whitespace-sensitive. Don't trust the model to produce exact byte sequences.

- **Overconfident "helpful" behavior when the job is narrow.** The first refix attempt on PR #82 was supposed to address a failing CI check (`eol-last`). Instead, Claude noticed — proactively, on its own — that `datacontenttype` was missing from the CloudEvents payload and added *that* instead. Technically a good observation. Functionally wrong: it left CI red and pushed an unasked-for change. Fix was a much stricter system prompt: *"Failing CI checks come FIRST. No proactive improvements allowed while CI is red."* **Lesson:** default LLM-helpful is the wrong default for a narrow-scope autonomous agent. Constraints have to be loud and explicit.

- **Bedrock model availability reality.** I expected to use Opus 4.7. My Bedrock account's foundation-model catalog listed 4.1 / 4.5 / 4.6 / 4.7 as "accessible," but all of them returned `AccessDeniedException` on-demand — they required custom inference profiles or provisioned throughput. Only the older Opus 4 had a public regional inference profile ready to go. Cost: ~30 min of head-scratching, 10 min of direct curl probes, before I accepted the older model and moved on. **Lesson:** the LLM's "capabilities" layer and the infra's "access" layer are decoupled in enterprise settings. The agent can't abstract this; you have to verify.

- **The chained-invocation pattern assumed sync.** Dashboard's `handleAction('fix')` did `await invoke('fix-issue'); await invoke('create-pr')`. CloudFront kills connections at 60s, but fix-issue takes 60-120s with Claude's tool loop. The `await` threw, `create-pr` never ran, the backend drafts got orphaned. Fix: merge create-pr into fix-issue server-side, make Dashboard treat 504s as "still running," add a polling loop. **Lesson:** network-reality-aware retry patterns don't emerge from the agent by default; you have to notice them in live traffic.

- **The "describe-instead-of-execute" trap — Prism's clearest unresolved failure.** Issue #32 (replace a broken URL) was the perfect typo task: Claude found the 3 matching files via `search_content`, then ended the turn with *"I found these files, let me prepare the updated content for each"* and never called `propose_edit`. Tightening the prompt made Claude more cautious instead of more decisive — it just burned all 15 iterations on repeated `read_file` + narration, hitting the 5-minute action timeout. I could not get Prism to commit this PR in 90 minutes of iteration. Full writeup in the Appendix. **Lesson:** prompt engineering ("just call the tools!") is not a reliable safety mechanism against a strong LLM reflex. Real fix is either (a) mechanical back-pressure in the loop — *"after N consecutive text-only turns, force a tool-or-abort turn"*, or (b) accepting that pure find-and-replace shouldn't use an agent at all — a deterministic 50-line helper beats a 15-iteration Claude loop on this exact class of task.

**Exceptionally well / pleasant surprises:**

- **Introspective debugging.** When I added a `_diag` diagnostic block to the triage action's response, Claude suggested richer fields (`token_prefix`, `client_created`, `path: 'llm' | 'heuristic' | 'llm-failed-fallback'`) than I'd have thought to add. Watching the agent debug its own tool use by adding better telemetry was genuinely new to me.

- **The abort tool saved Prism from pushing wrong code.** On refix attempt 4, Claude got confused about a mismatch between the file on the branch (which it believed had a trailing newline) and CI (which said it didn't). Rather than guess and push, Claude called `abort` with *"Could this be a CI cache issue or does the file need to be saved with different line endings?"* — framed as a question back to the reviewer. The diagnostic was wrong in its guess (the real cause was my noop-guard bug), but the decision to ask rather than act was exactly right for an autonomous agent. **Giving LLMs a graceful escape hatch is underrated.** It prevents the "LLM hallucinates + commits + breaks main" failure mode directly.

- **Architectural framing is a strength.** When I asked "how do we iterate on a PR after CI fails?" Claude produced the Tier 1 / Tier 2 / Tier 3 framework (manual button → auto-polling → webhooks) unprompted, explained the tradeoffs, and recommended the incremental shipping order. That's the kind of product thinking I'd expect from a senior engineer, not a code assistant.

- **Autonomous self-correction works when the feedback is good enough.** Once I fixed the three compounding bugs (CI logs not fetched, prompt not strict enough, trailing newline dropped), Claude's attempt 5 read the log tail, identified `182:3 error Newline required at end of file but not found eol-last`, proposed the minimal fix, normalizeEdit enforced the newline, and CI went green. The whole cycle was ~2 minutes from button-click to green CI. That's the future.

### 4. After this week, how comfortable using AI tools? (1–7)

**[ 6 / 7 ]** — up from 5. The shift is less about tool familiarity and more about trust calibration. I now have specific intuitions for *when* to trust Claude (scaffolding, boilerplate, prompt-based architecture decisions) and *when* to add guardrails (anything whitespace-sensitive, anything with an LLM-picks-the-wrong-thing-helpfully failure mode, any chained network call longer than 60s).

---

## Moving Forward

### 1. One specific change I will make in the future

**Pick the right tool for the shape of the problem before reaching for an agent.** The single biggest failure of the week (issue #32 — never committed a fix) was a find-and-replace task. A deterministic grep-and-rewrite helper would have produced a PR in under 10 seconds. Instead I handed it to a Claude tool-use loop that burned 15 iterations and a 5-minute action timeout on "let me continue reading." Going forward: if the problem has a clean mechanical solution, use it as the default path and keep Claude as the fallback for genuinely unstructured cases. Mechanical back-pressure inside the tool-use loop is the second-order fix, not the first.

### 2. What would have made this week more valuable

- **Pre-built webhook/I/O Events recipes.** I ran out of time before Tier 2 (auto-polling) and Tier 3 (real webhook-driven autonomy). A template that wires GitHub webhooks → I/O Events → an action would unlock real autonomy in half a day rather than the current full-day setup cost.
- **Documented matrix of Bedrock model + region + inference-profile availability.** The gap between "model is visible in my catalog" and "model is invocable on-demand in us-east-1" cost me meaningful time. An internal AUP cheat sheet would help everyone moving from Anthropic-direct to Adobe's Bedrock.
- **Standard patterns for CloudFront 60s async actions.** Everyone building long-running Claude-in-Runtime actions will hit this. A documented "kick + poll" template, or a shared helper to invoke async via activation ID and surface it in a dashboard, would be reused widely.
- **A shared pattern library of small "agent safety rails"** like `normalizeEdit`, `noop-guard`, `abort-tool-with-reason`. Each one is 20 lines of code but took a day of pain to discover the need for. Collecting them into a common module is high-leverage.

### 3. After this week, default approach to AI (1–7)

**[ 6 / 7 ]** — up from 5. Not a full 7 yet because some categories of work (debugging cross-system integrations, high-stakes production changes, security reviews) still feel safer to drive manually. Everything mechanical is AI-first now.

---

## Sharing Artifacts

### 1. Willing to share in a highlight?
**Yes.** Both narrative ("I built an autonomous AI engineer on App Builder that fixes App Builder") and demo (full pipeline from open issue to green CI).

### 2. How?
**Both file upload and hyperlink.**

### 3. Supporting artifacts to upload
- Screen recording of the dashboard: trigger → triage → fix → review modal → approve → PR goes ready-for-review
- Side-by-side: first refix attempt (hallucinates fix) vs. final refix attempt (reads CI logs, produces correct fix)
- Screenshot of the PR comment thread on adobe/aio-lib-events#82 showing Prism's iteration messages

### 4. Links
- Repo: https://github.com/arjuncooliitr/prism-appbuilder-agent
- Live dashboard: https://52381-567salmonmarsupial-stage.adobeio-static.net/index.html
- First autonomous PR: https://github.com/adobe/aio-lib-events/pull/82
- README with full architecture writeup: https://github.com/arjuncooliitr/prism-appbuilder-agent/blob/master/README.md

### 5. Overall, how valuable was AI Week? (0–10)

**[ 9 / 10 ]** — the honest number. Value in three layers:

1. **Shipped a working artifact** that has legs beyond the week. The pattern (App Builder + Bedrock + tool-use over GitHub API) is a template I'll reuse.
2. **Recalibrated my intuitions** about where AI is reliable vs. where it needs guardrails. The whitespace/overconfidence failure modes were a genuine lesson.
3. **Strategic credibility for the team.** "App Builder as the platform for AI agents" is easier to argue when you can point at a running agent built on App Builder.

The one deducted point is time: AI Week was the right length to build a Tier-1 autonomous loop, but not enough to wire real webhooks or build the shared "agent safety rails" library I now wish I had at the start. A follow-up sprint could close that.

---

## Appendix: Notable moments from the week

**Day 1, 18:47** — The key I pasted as `ANTHROPIC_API_KEY` turned out to be an **AWS Bedrock long-term API key** (`ABSKQm...`). Classic identifier-confusion bug. Pivoted the LLM layer from `@anthropic-ai/sdk` to `@anthropic-ai/bedrock-sdk` in one commit. The renamed variable + SDK swap took 15 minutes; recognizing the key format and choosing Bedrock over "get a real Anthropic key" was the interesting decision.

**Day 2, 12:04** — First autonomous PR ever opened by Prism: [adobe/aio-lib-events#81](https://github.com/adobe/aio-lib-events/pull/81). Correct diff, perfect targeting, real branch, real draft PR. The moment the system first did the thing it was built to do.

**Day 2, 13:06** — First `refix-pr` run. Claude proactively added `datacontenttype` without being asked. Discovered the "helpful agent" failure mode and rewrote the revision system prompt to be strict about red-CI-first.

**Day 2, 13:33** — Claude on attempt 4 refused to push a change and instead asked *"Could this be a CI cache issue?"*. The abort tool prevented a wrong commit. That felt like a good design decision paying off.

**Day 2, 13:45** — Attempt 5: eol-last fix committed (`8e47d1d`), CI went green on all three ubuntu builds. End-to-end verified: autonomous iteration based on real CI log signal actually works.

**Quote from Claude mid-debug:** *"Without access to the actual CI logs, I need to make an educated guess about what might be failing."* — catching that as a diagnostic clue (rather than treating it as a dead end) led me to realize `check.output.text` is almost always empty for GitHub Actions workflows, which led to the `fetchJobLogs` helper via `/actions/jobs/{id}/logs`. The agent told me exactly what was missing; I just had to listen.

**Day 3 — the unresolved roadblock: issue #32 (the rxjs-dev URL replacement).**

A canonical broken-link typo: the issue body just says *"See links to https://rxjs.dev/, See https://rxjs-dev.firebaseapp.com instead"*. The old URL exists in three files (`README.md`, `types.d.ts`, `src/index.js`). Prism triaged it correctly as P3 typo. Clicking Fix & draft PR produced `status: skipped, skip_reason: "no edits proposed"`. Prism never opened a PR.

I iterated on this for ~90 minutes across four attempts and could not get Claude to actually commit an edit. The specific failure mode compounded across three patterns:

1. **Search works, but commitment doesn't.** Claude successfully called `search_content("rxjs-dev.firebaseapp.com")`, got back matches across all 3 files, emitted a final-turn text like *"I found the URL in README.md (lines 496-499), src/index.js (lines 618-621), types.d.ts (lines 226-229). I need to replace all occurrences. Let me prepare the updated content for each file."* — and then **the turn ended**. No `propose_edit` calls. The plan was stated; the work wasn't done. Classic "describe instead of execute" LLM failure.

2. **Stricter prompts made it slower, not more decisive.** I rewrote the typo system prompt to explicitly say *"DO NOT narrate. Tool calls are the work. After search, your next turn must be propose_edit calls."* Subsequent attempt: Claude burned through all 10 → 15 MAX_ITERATIONS doing repeated `read_file` calls interleaved with *"Let me continue reading the file..."* text turns. It never got to `propose_edit`. The stricter prompt didn't change the behavior; it just made Claude more cautious.

3. **Action timeout triggered before a self-nudge could rescue.** At MAX_ITERATIONS=15 with 15-25s per Claude round trip, the action exceeded the 5-minute I/O Runtime timeout (`app error, duration: 301895ms`) before even the one-shot "you didn't call any tools, do it now or abort" rescue turn could fire. State never got written; the dashboard kept showing stale `skipped` from a prior attempt.

What I learned from this:

- **Prompt engineering is not a load-bearing safety mechanism.** "Don't narrate, just call tools" *sounds* like it should work. In practice Claude (Opus 4) has a strong reflex to explain-then-act, and any uncertainty in the task routes through the explain path. You can't fix this with more forceful English.
- **Tool-use loops need mechanical back-pressure, not just budget caps.** A hard iteration cap just trades "infinite narration" for "narration that hits the cap and stops." What's actually needed is a loop-internal controller: *"if 2 consecutive turns contain no `propose_edit` calls, inject a forced tool-or-abort turn."* That's a small design change I ran out of time to ship.
- **Some tasks don't need an agent.** This issue — three files, one string, global replace — is the kind of thing a deterministic helper (grep repo, replace, commit) does reliably in 50 lines of code. The correct design for Prism's typo archetype is probably *"try a deterministic string-replace first; only fall back to the Claude loop if the issue isn't a simple find-and-replace."* LLMs are best when the problem is genuinely unstructured; forcing them through a task that has a clean mechanical solution is an anti-pattern I only saw clearly in retrospect.
- **Honest status reporting matters more than a green demo.** #32 remains `skipped` in the dashboard as I submit this reflection. That's the right state — "Prism tried, Prism could not, here's why" beats a papered-over success. The dead-end *is* the lesson. Leaving it visible is the point.

---

## Outstanding (for Day 3+ or post-AI-Week)

Not done this week but worth capturing:

- **Tier 2 — auto-poll** on dashboard refresh: every `fetch-issues` tick also checks PR status for issues in `awaiting-review` or `approved`, surfaces a red-dot "needs attention" badge, optionally auto-triggers refix.
- **Tier 3 — real webhooks** via a custom I/O Events provider that Prism owns. GitHub PR events → Prism action → autonomous iteration without a human click.
- **Real dep-bump archetype** (currently stubbed). Deterministic path: parse `package.json`, query npm registry for latest patch, generate PR. No Claude needed for the bump itself; Claude could author the PR body.
- **Deterministic-first for typo archetype.** Same principle: parse the issue body for "replace X with Y" style patterns, grep the repo, rewrite files, commit. Only fall through to the Claude tool-use loop for typos whose target string isn't cleanly extractable. This would have resolved issue #32 in seconds.
- **In-loop back-pressure in `runFixLoop`.** If 2 consecutive Claude turns contain no `propose_edit` or `abort` tool calls (just text / repeated reads), inject a forced tool-or-abort message mid-loop instead of waiting for loop exit. The current one-shot rescue only fires after the main loop ends, which is too late when MAX_ITERATIONS was spent thrashing.
- **Fork-fallback** for repos where the user lacks push access (e.g., aio-theme in my account). Hybrid mode: try origin branch, fall back to fork.
- **Merge watcher** — transition issue state to `merged` when GitHub marks the PR merged; feed the outcome into triage quality metrics.
- **Prompt caching optimization** — the system prompt per archetype is ~2KB; caching it properly would drop token costs ~80%. Currently the `cache_control: ephemeral` block is there but cache hit rates are uneven; needs investigation.
