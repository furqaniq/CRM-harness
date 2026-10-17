# Maple Harness

An agent harness for the Maple mortgage CRM. Build spec: [`maple_harness_spec.html`](./maple_harness_spec.html)
(open it in a browser for the visual target and the full behavioural spec).

Stack and step-by-step plan: [`plan.md`](./plan.md). Progress: [`spine.md`](./spine.md).

## Stack

- **Next.js 16 (App Router) + TypeScript**, strict mode, pnpm.
- **Core engine as a local library** (`src/core/`) so the agent loop is usable by routines,
  subagents and tests.
- **SSE streaming** via Route Handlers for the chat.
- **SQLite** for runs, logs and config; secrets encrypted at rest, never sent to the browser.
- **Vitest** for unit tests.
- Provider-agnostic: Anthropic, OpenAI, Gemini, any OpenAI-compatible endpoint.

**Status: M0–M3 complete (S1–S14).** Implemented so far: scaffold, design tokens, app shell,
CI, provider abstraction (Anthropic / OpenAI / Gemini / OpenAI-compatible / scripted demo model), the
core agent loop, the streaming chat (`POST /api/chat` runs the loop and streams SSE frames that the
browser renders as text, step traces and token/cost usage, with Stop cancelling a run mid-flight),
the MCP layer (stdio / streamable-HTTP / legacy-SSE transports, handshake + tool discovery, classing,
the tool registry, and the `/mcp` workspace backed by `POST /api/mcp`), the policy engine (global deny
pattern, per-scope auto/ask/deny by tool class with Owner-mode and unattended rules, glob allow/deny
lists, agent tool scoping), large-result artifacts (20 KB threshold; over that, the model gets a
summary with the exact item count plus a handle, and `read_artifact` pages the payload back in
slices), the in-memory CRM simulator (~30 Maple-shaped tools, deterministic seed, deliberate
quirks, outbox-only sends, reset/snapshot), subagents (`spawn_agent`/`spawn_agents` with fail-closed
tool scopes, depth 2, max 6 parallel), the planner (validated task graphs run in dependency waves),
the write coordinator (per-record locks, idempotent writes, read-after-write verification stamped on
results, 10-minute send guard), the trace lanes UI (specialists stream into side-by-side lane cards
under the root reply), and the minimal Test Lab (`src/core/lab/` — deterministic checks over 11
own safe rows executed against the real chat route with pass rates per module; first run: 11/11).
Next up: M4 — skills system and seed agents/skills/persona.

## Setup

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate route types, then `tsc --noEmit` |
| `pnpm test` | Vitest once |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm verify` | lint + typecheck + test + build (what CI runs) |

## Project layout

```
src/
  app/          Next.js routes inside the (shell) route group, layout, design tokens (globals.css)
    api/chat/   SSE chat route: runs the agent loop, accepts { cancelRunId }
    api/mcp/    MCP action route: add/update/remove/test/discover/call/import, returns a snapshot
  components/   shell (rail, panel, top bar, live token meter), chat UI (workspace, reducer with
                per-agent lane traces, prompt box) and the MCP workspace (server cards, tools table,
                tool console)
  design/       Design tokens mirrored in TS, enforced by tokens.test.ts
  core/         Local engine library:
    providers/  neutral chat types, Anthropic + OpenAI SSE adapters, provider registry, scripted demo model
    models/     model configs, roles, fallback chains, token and cost accounting
    events/     SSE encode/decode shared by the route and the browser; EventMux merges subagent
                streams into the parent chat stream
    loop/       agent loop: context assembly, streaming, parallel tool calls, limits, cancellation,
                policy consulted before every tool call (deny blocks, ask waits for an approver),
                artifactization of oversized tool results
    artifacts/  large-result artifacts: 20 KB threshold, store + summary with exact item counts,
                read_artifact tool that pages payloads back in slices
    mcp/        MCP client: JSON-RPC channel, stdio/HTTP/legacy-SSE transports, handshake,
                tool discovery, manager with statuses/rate limits, .mcp.json import, defaults
    policy/     policy engine: global deny pattern, per-scope auto/ask/deny by class,
                Owner-mode and unattended rules, allow/deny globs
    tools/      tool registry (server sync, model listing, scoped() views), class inference
                and glob matching for scopes and allow/deny lists
    simulator/  in-memory CRM: seeded leads/contacts/branches/automations/conversations, ~30
                Maple-shaped tools, quirk switches, outbox-only sends, reset/snapshot/restore
    agents/     subagent runner: AgentSpec, spawn tools, concurrency/depth limits, interim agents
    planner/    task graph validation, dependency waves, wave runner with failure isolation
    coordinator/ per-record locks, idempotency, read-after-write verification, 10-minute send guard
    lab/        minimal Test Lab: deterministic checks, safe row set, runLab() pass-rate reports
  scripts/      demo-mcp-server.mjs — bundled stdio MCP demo server (sample tools, not Maple)
  (routines, skills arrive with their milestones)
```

Spec assets the plan expects (`fixtures/`, `design/`, workbooks, `SOUL.maple.md`) are **not in the
repo** — see Known gaps.

## Milestones

Gated: at the end of each milestone, demo, run its tests, commit, stop for review.
The full step list lives in [`plan.md`](./plan.md) and is tracked in [`spine.md`](./spine.md).

| M | Scope |
| --- | --- |
| M0 | Scaffold, CI, design tokens, app shell |
| M1 | Provider layer, core loop, streaming chat |
| M2 | MCP manager, tool registry, policy, artifacts, CRM simulator |
| M3 | Subagents, planner, write coordinator, trace lanes, minimal test runner |
| M4 | Skills system, seed agents/skills/persona |
| M5 | Loops, routines, scheduler, kill switch |
| M6 | Full Test Lab |
| M7 | Auth, secrets, budgets, audit log, embed mode, docs |

## Working agreement

- One milestone at a time: demo, test, commit, stop for review.
- Commit at the end of every step; push only with explicit permission.
- No hard-coding answers to test prompts, no special-casing test IDs, no editing expected-behaviour
  columns. Pass/fail numbers are reported honestly.
- Anything stubbed is listed under Known gaps.

## Known gaps

- **Missing spec inputs.** The spec expects `fixtures/` (real CRM tool definitions), `design/`
  (screenshot), two test workbooks and `SOUL.maple.md`. None exist in this repo yet. Work proceeds
  against the spec's own tool names plus a simulator until they are provided — which means the
  workbooks' rows (including INT-05) cannot be replicated: the Test Lab runs our own safe row set
  instead, reported honestly as such.
- **The Test Lab is layer 1 only (deterministic checks).** `src/core/lab/` runs 11 own safe rows
  against the real chat route and reports pass rates per module (first run: 11/11). The LLM judge,
  calibration and gold set (S22), workbook import (S20) and the lab UI with xlsx export (S23) are
  not built; artifact handles (`art_…`) are excluded from the no-internal-ids check by design.
- **The session token meter is client-side and its budget is a placeholder.** `SESSION_TOKEN_BUDGET`
  is 100,000 until spend caps (M7) define the real limits; usage lives in React state, so a page
  refresh resets it. There is no server-side ledger or enforcement yet.
- **Stop force-closes the stream after 3s.** Stop posts `{ cancelRunId }` and lets the run end on its
  own so `run_end` still carries the usage; if the run does not finish within `STOP_FORCE_MS`, the
  connection is aborted and the reply shows what had streamed so far.
- **Run history is chat-local.** Runs are only what the transcript shows; there is no persisted run
  store yet (the Runs page arrives with the milestones that write to storage).
- **Context compaction is drop-oldest only.** `maxContextTokens` trims the oldest turn when the
  estimate goes over budget, keeping tool results paired with their calls. The spec's summarising
  compaction at 75% of the window, session memory of resolved references, and "ask which one" when
  several entities were just shown are not implemented yet.
- **MCP configuration lives in memory.** Add/update/remove and tool settings are held by the
  in-process manager (`src/core/mcp/manager.ts`), so they reset when the server restarts; there is
  no persisted MCP config until storage lands. The OAuth auth type returns a plain "not yet" error —
  that arrives with secrets (M7).
- **The stdio transport spawns a local child process** (`scripts/demo-mcp-server.mjs`). It works in
  `pnpm dev` and tests but cannot run on Vercel's serverless functions — HTTP/SSE servers are the
  deployable path (see D1/D2). The bundled demo tools are samples, not the real Maple CRM, and the
  preconfigured "Maple CRM" entry is a disabled placeholder pointing at `crm.maple.example`.
- **Policy is enforced but not yet approvable from the UI.** The chat route serves the simulator's
  tools through the policy engine (deny → a model-visible "Denied by policy" result; ask → blocked
  with the reason until an approver is wired). Owner mode (shell toggle, on by default) is the only
  gate today: with it off, live-effect calls become ask and are blocked. There is no interactive
  approval card for `ask` yet, and `registry.scoped()` has no consumer until agent files arrive in M4.
- **The CRM simulator is a deliberate subset.** ~30 tools covering the M2 gate paths; there are no
  delete tools in the simulator at all (the deny demo has the model propose one anyway, and policy
  stops it before execution). Data is in-memory and seeded per process; quirks are switchable in
  core but not yet from the UI or Test Lab. The "Maple CRM" MCP entry remains a disabled placeholder.
- **Artifacts are in-memory and per-process.** The store lives for the life of the server, so a
  handle read after a restart reports "unknown handle" in plain language; there is no LRU cap or
  persistence yet (storage milestone). Chat enables artifacts, but handles only survive while the
  dev server process lives.
- **Seed agents are interim placeholders.** `INTERIM_AGENTS` (`src/core/agents/seed.ts`) defines
  leads/inbox/contacts specialists inline until seed files land (M4); the root chat run still holds
  the full simulator tool set rather than the orchestrator-minimal scope, and per-agent policy files
  arrive with those seeds. The demo model cannot author a planner `depends_on` graph from chat, so
  the planner has no chat-driven lab row.
- **Agents, Skills, Loops, Providers, Runs, Test Lab and Settings routes are placeholders**
  (each states the milestone it arrives in). Chat/, MCP and the shell are live.
- **Vercel vs. long-running work.** The interactive harness will deploy to Vercel. The scheduler
  (M5, 15-minute loops and cron routines) needs always-on execution that Vercel Cron cannot provide
  on its own — to be resolved or recorded as a gap at the M5 gate.
- **Branch switcher, language picker and search (Ctrl K) are inert** until their milestones land;
  Ctrl K focuses the search field but searching itself is not wired.
