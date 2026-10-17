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
| S5 | Streaming chat UI, glowing prompt box, stop, token meter | [x] | `7f10429` | yes |
| S6 | MCP manager (stdio/HTTP/SSE) + tool registry | [x] | `2849ddb` | yes |
| S7 | Policy engine + tool scoping | [x] | `235df2f` | yes |
| S8 | Large-result artifacts | [x] | `34009a4` | yes |
| S9 | CRM simulator (data, quirks, outbox, reset/snapshot) | [x] | `0b3adf6` | pending |
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
- [x] M2 complete — simulator (S9); remote MCP server connect done with S6 (stdio/HTTP/SSE
  transports tested end-to-end); deny pattern blocks delete tools (chat demo: `docs/m2-chat-deny.png`
  — the demo model proposes `lead_delete`, policy denies it before any executor, and the answer says
  so); 270 KB result handled (chat demo: `docs/m2-chat-artifact.png` — the 405 KB automation list is
  summarized with its exact 950-item count plus a handle; `docs/m2-chat-read.png` pages a slice;
  `docs/m2-chat-outbox.png` shows a send queued to the simulator outbox)
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
- MCP config is in-memory (process-local manager): add/update/remove/tool settings reset on server
  restart; no persisted config until storage lands. OAuth auth type is refused with a plain error
  until secrets (M7).
- The stdio MCP transport spawns a local child process — fine for `pnpm dev` and tests, not
  deployable on Vercel serverless (D1/D2). Bundled demo tools are samples, not the real Maple CRM;
  the "Maple CRM" entry is a disabled placeholder.
- Policy enforcement is live in chat (S9): the route serves the simulator's tools through the
  policy engine; deny returns the model-visible "Denied by policy" result, ask (Owner mode off)
  is blocked with the reason because no approver is wired. There is still no interactive approval
  card for `ask`; `registry.scoped()` has no consumer until agent files land (S16).
- The CRM simulator is a deliberate subset: ~30 tools covering the M2 gate paths, seeded in-memory
  data (leads/contacts/branches/automations/conversations), quirk switches in core only, and no
  delete tools at all — the deny demo has the model propose one anyway. Reset/snapshot/restore work
  in core but are not yet driven by the UI or Test Lab.
- Artifacts in chat are in-memory per process: handles survive only while the dev server lives;
  a restart reports "unknown handle" in plain language (persistence arrives with storage).

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
- S6 done (`2849ddb`): MCP layer. `src/core/mcp/` speaks JSON-RPC over three transports — stdio
  (child process with plain ENOENT/write-failure errors), streamable HTTP (bearer/header auth) and
  legacy SSE — with handshake, `notifications/initialized`, paginated `tools/list` and `tools/call`.
  A manager tracks per-server status (connecting/connected/error/disabled), rate limits, timeouts
  and lazy reconnect, seeded with a disabled "Maple CRM" placeholder plus a bundled stdio demo
  server (`scripts/demo-mcp-server.mjs`, sample tools only). `src/core/tools/` adds the registry
  (server sync preserving operator edits, server-qualified names on collisions) and class
  inference: deny words win, unclassified tools default to `live-effect` (ask), labels are
  humanized. `POST /api/mcp` handles add/update/remove/test/discover/call/import/setTool and always
  returns a fresh snapshot; OAuth is refused with a plain "not yet". The `/mcp` page is live: server
  cards (Test/Discover/Enable/Remove), tools table (display label, class, verify-with, enabled),
  tool console and `.mcp.json` import — browser-checked end-to-end (discover 6 tools, call returns
  lead JSON, class survives rediscovery, plain-language failure for an unreachable server).
  147 tests green (`pnpm verify`), screenshots `docs/m2-mcp.png`, `docs/m2-mcp-tools.png`,
  `docs/m2-mcp-mobile.png`. S7 (policy engine) next.
- S7 done (`235df2f`): policy engine + tool scoping. `src/core/policy/` decides auto/ask/deny per
  call in the spec's order — global deny pattern on the tool name first (delete, remove, archive,
  destroy, merge beats every allow list), then scope deny globs, scope allow globs (explicit
  operator intent), then the most specific scope's per-class mode (workspace < agent < routine),
  then the defaults: read/write auto, live-effect ask, auto in interactive chat only with Owner
  mode on, denied unattended unless allowlisted, destructive deny; `ask` in an unattended run
  becomes deny because nobody can approve. Reasons are plain language, safe for traces and for the
  model. `src/core/tools/` grew a glob matcher and `scopeTools` (fails closed: empty scope = no
  tools; deny-pattern tools are never in anybody's context), plus `registry.scoped()`. The loop now
  takes `policy` and `approve`: deny returns a model-visible "Denied by policy" result without
  executing, ask waits for the approver (none connected → blocked with the reason), and `tool_start`
  carries `{ decision, reason }` for ask/deny so the UI can render it later. 191 tests green
  (`pnpm verify`). Known gap recorded: chat exposes no tools yet, so policy has no UI demo until
  the simulator step; the M2 gate demo needs chat to serve registry tools and the demo model to
  script tool calls. S8 (large-result artifacts) next.
- S8 done (`34009a4`): large-result artifacts. `src/core/artifacts/` stores any tool result over
  the spec's 20 KB threshold (§11) and replaces it in context with a short message: handle, size,
  an exact item count when the payload is a list, a 300-character preview, and the note that the
  full payload is not in context. `read_artifact` pages a stored payload back in slices (8 KB
  default window, 20 KB max, plain-language errors for unknown handles). The loop gained
  `RunOptions.artifacts`: over-threshold results are stored, `tool_result` carries
  `{ id, bytes, summary, itemCount }` for the UI, and `read_artifact` is added to the run
  automatically when a store is present. Proven with a 270 KB automation list (the simulator's
  known 270 KB quirk) kept out of context while remaining readable. 210 tests green
  (`pnpm verify`). Known gaps: store is in-memory per process (handles die with a restart, no
  persistence until storage); chat still exposes no tools, so the gate's chat demo waits on S9.
  S9 (CRM simulator) next — it closes M2 once chat serves registry tools through policy and the
  demo model can script tool calls for the gate demo.
- S9 done (`0b3adf6`): CRM simulator closes M2. `src/core/simulator/` seeds a deterministic Maple
  (5 leads with a twin-contact quirk, 4 contacts, branches incl. two "San Diego" and a Reno with no
  agents, 950 automations ≈ 405 KB, 22 conversations, users with an owner role) and exposes ~30
  tools: reads, lead/contact create+update+transfer with read-back-after-write, campaign/drip
  controls, template/outbox sends with a duplicate guard, role-scoped inbox. Quirk switches cover
  intermittent branch_list failures, a campaign-step wrong-field bug, company-list validation with
  a Levenshtein suggestion, unsubscribed-contact hiding, draft-drip refusal and a non-owner
  pipeline_create permission gap. `db.reset/snapshot/restore` support tests and the UI. Chat now
  runs the simulator's tools through the policy engine with artifacts enabled: the demo model
  routes prompts to tool calls (delete-shaped prompts deliberately propose `lead_delete`, which
  policy denies before any executor; answers on the second turn are derived from the real tool
  result — denial, artifact summary with handle, count, outbox queue). Owner mode is sent from the
  shell (`ShellContext`) and gates live-effect calls to ask when off. The 405 KB automation list is
  summarized with its exact 950-item count (`summarizeResult` now finds counts in any array-valued
  field, not just LIST_KEYS). Browser-verified M2 gate: deny (`docs/m2-chat-deny.png`), artifact
  (`docs/m2-chat-artifact.png`), artifact slice read (`docs/m2-chat-read.png`), outbox
  (`docs/m2-chat-outbox.png`). 240 tests green (`pnpm verify`). **M2 gate reached** — ready for
  review before M3.
