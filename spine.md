# spine.md — Maple Harness progress tracker

Single source of progress. Updated at every step boundary.
Legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked.

Full plan: `plan.md`. Source of truth: `maple_harness_spec.html`.

## Status

| # | Step | Status | Commit | Pushed |
|---|------|--------|--------|--------|
| S1 | git init, scaffold, CI, design tokens, lint/typecheck, README | [x] | `e983cd8` | yes |
| S2 | App shell (rail, panel, top bar, token meter) | [x] | `c2d562d` | yes |
| S3 | Provider abstraction + model config | [x] | `1ba2a26` | yes |
| S4 | Core agent loop (stream, parallel tools, limits, cancel) | [x] | `6a83c9d` | yes |
| S5 | Streaming chat UI, glowing prompt box, stop, token meter | [x] | `7f10429` | pending |
| S6 | MCP manager (stdio/HTTP/SSE) + tool registry | [ ] | | |
| S7 | Policy engine + tool scoping | [ ] | | |
| S8 | Large-result artifacts | [ ] | | |
| S9 | CRM simulator (data, quirks, outbox, reset/snapshot) | [ ] | | |
| S10 | Subagent runner (spawn_agent/spawn_agents) | [ ] | | |
| S11 | Planner (task graph, parallel fanout, failure isolation) | [ ] | | |
| S12 | Write coordinator (locking, idempotency, read-after-write) | [ ] | | |
| S13 | Trace lanes UI | [ ] | | |
| S14 | Minimal test runner + first pass rates | [ ] | | |
| S15 | Skills system | [ ] | | |
| S16 | Seed agents/skills/persona + Agents & Skills pages | [ ] | | |
| S17 | Loops (interval/goal/watch) | [ ] | | |
| S18 | Routines + scheduler | [ ] | | |
| S19 | Kill switch + history + unattended policy | [ ] | | |
| S20 | Test Lab workbook import | [ ] | | |
| S21 | Deterministic checks | [ ] | | |
| S22 | LLM judge + calibration | [ ] | | |
| S23 | Results table, diff, export, regression pack | [ ] | | |
| S24 | Auth, secrets, budgets, audit log | [ ] | | |
| S25 | Embed mode | [ ] | | |
| S26 | Packaging, docs, clean-clone setup | [ ] | | |
| D1 | Vercel project via composio | [ ] | | |
| D2 | Vercel deploy via composio + READY URL | [ ] | | |

## Milestone gates

- [x] M0 complete — shell matches spec section 1, screenshot saved to `docs/` (`docs/m0-shell.png`, `docs/m0-shell-mobile.png`)
- [x] M1 complete — provider tested against an injected fetch, chat streams over SSE, stop mid-run works, token meter tracks real usage; scripted demo model (`docs/m1-chat.png`, `docs/m1-chat-mobile.png`)
- [ ] M2 complete — simulator + remote server connect; deny pattern blocks delete; 270 KB result handled
- [ ] M3 complete — parallel lanes in one step; one-record create; read-after-write; pass rates
- [ ] M4 complete — all seed files load/validate; `/skill` and `@agent` work
- [ ] M5 complete — seed routines run; unattended cannot live-effect; overlap/missed-run tested
- [ ] M6 complete — row counts match workbooks; run all safe; xlsx export
- [ ] M7 complete — clean-clone setup; secrets never to browser; embed demo; README complete

## Known gaps

- Missing inputs: `fixtures/` (tool definitions), `design/` screenshot, two test workbooks,
  `SOUL.maple.md`. Building against spec tool names + simulator until provided.
- Context handling is drop-oldest by token budget (`maxContextTokens` in `src/core/loop/context.ts`).
  Summarising compaction at 75% of the window, session memory of resolved references and the
  "ask which one" rule (spec §4 Context) are not implemented yet.
- M5 scheduler vs. Vercel Cron limits — to be resolved or recorded at the M5 gate.
- Session token meter is client-side (React state, resets on refresh) and `SESSION_TOKEN_BUDGET`
  (100,000) is a placeholder until M7 spend caps; no server-side ledger or enforcement yet.
- Stop posts `{ cancelRunId }` and lets `run_end` land so usage is recorded, force-aborting the
  stream only after `STOP_FORCE_MS` (3s).

## Log

- Plan approved; `plan.md` and `spine.md` created.
- S1 done (`e983cd8`, pushed): Next.js 16 scaffold, design tokens, lint/typecheck/test/build all
  green, GitHub Actions CI, README with Known gaps. Repo `furqaniq/CRM-harness` created via composio
  GitHub toolkit.
- S2 done (`c2d562d`): app shell per spec section 1 — 64px rail, 260px panel with Ctrl K search and
  token meter, top bar with branch/language/owner mode, glowing prompt box, nine routes (eight are
  placeholders), responsive at 760px. 15 tests green. Screenshot in `docs/`.
- **M0 gate reached** — ready for review before M1.
- M0 pushed; user approved scripted-mock-first for M1 (a real key is only needed when testing a
  provider in the UI).
- S3 done (`1ba2a26`): neutral chat types + typed event stream, Anthropic and OpenAI/OpenAI-
  compatible/Gemini SSE adapters, provider registry, model roles + fallback chains + cost
  accounting, scripted mock provider. Transport tested with an injected fetch. 33 tests green.
- S4 done (`6a83c9d`): core agent loop in `src/core/loop/` — `runAgent()` async generator emits one
  typed event stream (run/step ids, text deltas, tool_start/tool_result sharing a step id, usage,
  model_error, run_end) and returns a `RunSummary` with the transcript, so routines, subagents and
  tests use it as a library. Independent tool calls of one step run in parallel and are dispatched
  before any of them finishes; tool failures, malformed arguments and unknown tools come back as
  tool errors the model can read. Limits: steps, time, tokens, cost (each stops the run with a
  named limit), plus external cancellation during streaming or mid-tool. Provider fallback chain
  retries only when a call fails before any output. Context assembly trims the oldest turn by token
   budget without orphaning tool results. Mock provider grew per-call scripts for multi-turn tests.
   59 tests green (`pnpm verify`: lint, typecheck, test, build).
- S5 done (`7f10429`): streaming chat closes M1. `POST /api/chat` runs the agent loop and writes
  SSE frames; the browser reads them through `src/core/events/sse.ts` into a reducer
  (`chatState.ts`) that renders messages, step traces and run notices. Trace cards show
  `✓ Answered in 0.2s` plus tokens/steps by default and raw model ids, context size and step lines
  only behind Advanced (spec §1). Stop posts `{ cancelRunId }`, lets `run_end` carry the usage
  (3s force-abort guard), so cancelled runs still count in the meter. Token meter is now a live
  session store fed by `run_end`; the side panel shows runs and cost for the session. Demo model
  provider (`src/core/providers/demo.ts`) answers through the real loop. 89 tests green
  (`pnpm verify`), `@/` alias added to vitest config.
- **M1 gate reached** — ready for review before M2. Screenshots: `docs/m1-chat.png`,
  `docs/m1-chat-mobile.png`.
