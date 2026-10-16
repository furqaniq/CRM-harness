# spine.md — Maple Harness progress tracker

Single source of progress. Updated at every step boundary.
Legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked.

Full plan: `plan.md`. Source of truth: `maple_harness_spec.html`.

## Status

| # | Step | Status | Commit | Pushed |
|---|------|--------|--------|--------|
| S1 | git init, scaffold, CI, design tokens, lint/typecheck, README | [x] | `e983cd8` | yes |
| S2 | App shell (rail, panel, top bar, token meter) | [x] | `c2d562d` | pending |
| S3 | Provider abstraction + model config | [ ] | | |
| S4 | Core agent loop (stream, parallel tools, limits, cancel) | [ ] | | |
| S5 | Streaming chat UI, glowing prompt box, stop, token meter | [ ] | | |
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
- [ ] M1 complete — add/test provider, stream chat, stop mid-run, token meter; scripted mock model
- [ ] M2 complete — simulator + remote server connect; deny pattern blocks delete; 270 KB result handled
- [ ] M3 complete — parallel lanes in one step; one-record create; read-after-write; pass rates
- [ ] M4 complete — all seed files load/validate; `/skill` and `@agent` work
- [ ] M5 complete — seed routines run; unattended cannot live-effect; overlap/missed-run tested
- [ ] M6 complete — row counts match workbooks; run all safe; xlsx export
- [ ] M7 complete — clean-clone setup; secrets never to browser; embed demo; README complete

## Known gaps

- Missing inputs: `fixtures/` (tool definitions), `design/` screenshot, two test workbooks,
  `SOUL.maple.md`. Building against spec tool names + simulator until provided.
- M5 scheduler vs. Vercel Cron limits — to be resolved or recorded at the M5 gate.

## Log

- Plan approved; `plan.md` and `spine.md` created.
- S1 done (`e983cd8`, pushed): Next.js 16 scaffold, design tokens, lint/typecheck/test/build all
  green, GitHub Actions CI, README with Known gaps. Repo `furqaniq/CRM-harness` created via composio
  GitHub toolkit.
- S2 done (`c2d562d`): app shell per spec section 1 — 64px rail, 260px panel with Ctrl K search and
  token meter, top bar with branch/language/owner mode, glowing prompt box, nine routes (eight are
  placeholders), responsive at 760px. 15 tests green. Screenshot in `docs/`.
- **M0 gate reached** — ready for review before M1.
