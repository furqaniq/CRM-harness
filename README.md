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

**Status: M0 and M1 complete; M2 in progress (S6 done).** Implemented so far: scaffold, design
tokens, app shell, CI, provider abstraction (Anthropic / OpenAI / Gemini / OpenAI-compatible /
scripted demo model), the core agent loop, the streaming chat (`POST /api/chat` runs the loop and
streams SSE frames that the browser renders as text, step traces and token/cost usage, with Stop
cancelling a run mid-flight), and the MCP layer: stdio / streamable-HTTP / legacy-SSE transports,
handshake + tool discovery, classing, the tool registry, and the `/mcp` workspace backed by
`POST /api/mcp`. Next up: the rest of M2 (policy engine, large-result artifacts, CRM simulator).

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
  components/   shell (rail, panel, top bar, live token meter), chat UI (workspace, reducer,
                prompt box) and the MCP workspace (server cards, tools table, tool console)
  design/       Design tokens mirrored in TS, enforced by tokens.test.ts
  core/         Local engine library:
    providers/  neutral chat types, Anthropic + OpenAI SSE adapters, provider registry, scripted demo model
    models/     model configs, roles, fallback chains, token and cost accounting
    events/     SSE encode/decode shared by the route and the browser
    loop/       agent loop: context assembly, streaming, parallel tool calls, limits, cancellation
    mcp/        MCP client: JSON-RPC channel, stdio/HTTP/legacy-SSE transports, handshake,
                tool discovery, manager with statuses/rate limits, .mcp.json import, defaults
    tools/      tool registry (server sync, model listing, name collisions) + class inference
  scripts/      demo-mcp-server.mjs — bundled stdio MCP demo server (sample tools, not Maple)
  (policy, planner, coordinator, routines, skills arrive with their milestones)
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
  against the spec's own tool names plus a simulator until they are provided.
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
- **Agents, Skills, Loops, Providers, Runs, Test Lab and Settings routes are placeholders**
  (each states the milestone it arrives in). Chat/, MCP and the shell are live.
- **Vercel vs. long-running work.** The interactive harness will deploy to Vercel. The scheduler
  (M5, 15-minute loops and cron routines) needs always-on execution that Vercel Cron cannot provide
  on its own — to be resolved or recorded as a gap at the M5 gate.
- **Branch switcher, language picker and search (Ctrl K) are inert** until their milestones land;
  Ctrl K focuses the search field but searching itself is not wired.
