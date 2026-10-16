# Maple Harness — Build Plan

An agent harness for the Maple mortgage CRM. Source of truth: `maple_harness_spec.html`.
This plan was chosen in plan mode with the coding agent, per the spec's section 2.

## Stack (decided)

- **Next.js 16 (App Router) + TypeScript**, strict typing, pnpm.
- **Core engine as a local library** (`src/core/`) so the agent loop is usable as a library by
  routines, subagents, and tests (spec requirement).
- **SSE streaming** via Route Handlers for the chat UI.
- **React frontend** matching design tokens in spec section 1 (black canvas, CRM orange accent,
  yellow-to-orange glow ring).
- **SQLite** for runs, logs, config; secrets encrypted at rest.
- **Vitest** for unit tests (minimal test runner arrives in M3).
- Provider-agnostic: Anthropic, OpenAI, Gemini, any OpenAI-compatible endpoint.

Rationale: a single full-stack Next.js app satisfies "self-hostable" (`next start`), deploys cleanly
to Vercel, and shares strict types across core, server, and UI.

## Repo

- New GitHub repo `CRM-harness` (**public**), created via the composio GitHub toolkit.
- Working dir: `/home/furqan-iqbal/Desktop/Ai work/CRM Harness` (currently not a git repo).
- GitHub and Vercel toolkits are connected in composio (session: furqan93@gmail.com).

## Pacing and working agreement

- **One milestone at a time** (spec section 2): build it, demo it, run its tests, commit, then
  **stop for review** before starting the next milestone.
- **Commit at the end of every step.** **Ask for permission before every `git push`** and before any
  Vercel deploy.
- No hard-coding answers to test prompts, no special-casing test IDs, no editing expected-behavior
  columns. Report honest pass/fail numbers.
- Anything stubbed goes under "Known gaps" in the README and in `spine.md`.
- `spine.md` is updated at each step boundary (status, commit, pushed).

## Tracked risks

1. **Vercel vs. long-running work.** The scheduler/loops (M5) need cron + always-on execution.
   Vercel functions have max-duration limits; Vercel Cron is limited (daily on Hobby). The
   interactive harness will deploy and run on Vercel; M5 scheduling may need an external trigger or
   be listed as a known gap. Will flag at the M5 gate.
2. **Missing inputs.** The spec references `fixtures/`, `design/` (screenshot), two test workbooks,
   and `SOUL.maple.md` — none exist in the directory (only the spec HTML is present). Spec section 12
   says gather these before M2. Plan: build against the spec's own tool names plus a simulator-driven
   Test Lab, and list absent workbooks/inputs as known gaps until provided.

## Steps

Each step ends with: implement → run lint/typecheck/tests → commit → ask to push → update `spine.md`.

### M0 — Scaffold + shell
- **S1**: `git init`, repo scaffold, CI, design tokens, lint/typecheck, README.
- **S2**: App shell (icon rail, collapsible panel, top bar, token meter) matching spec section 1.

### M1 — Provider + loop + streaming chat
- **S3**: Provider abstraction (Anthropic/OpenAI/OpenAI-compatible) + model config.
- **S4**: Core agent loop (context assembly, stream, parallel tool calls, limits, cancel).
- **S5**: Streaming chat UI, glowing prompt box, stop button, token meter.

### M2 — MCP + tools + policy + artifacts + simulator
- **S6**: MCP manager (stdio, streamable HTTP, legacy SSE) + tool registry.
- **S7**: Policy engine (read/write/live-effect/destructive, global deny pattern) + tool scoping.
- **S8**: Large-result artifacts (threshold + summary/handle + read-artifact tool).
- **S9**: CRM simulator (seeded data, quirks, outbox, reset/snapshot).

### M3 — Subagents + coordinator + trace + minimal test runner
- **S10**: Subagent runner (`spawn_agent` / `spawn_agents`, structured results, budgets, depth limits).
- **S11**: Planner (task graph, dependencies, parallel fanout, failure isolation).
- **S12**: Write coordinator (per-record locking, idempotency, read-after-write).
- **S13**: Trace lanes UI (parallel calls share a step id).
- **S14**: Minimal test runner + first pass rates reported.

### M4 — Skills + seed content
- **S15**: Skills system (folder per skill, load on demand, UI to list/edit/test/import/export).
- **S16**: Seed agents/skills/persona files; Agents and Skills pages; `/skill` and `@agent`.

### M5 — Loops + routines + scheduler
- **S17**: Loops (interval, goal, watch; limits, stop condition, countdown, Stop).
- **S18**: Routines + scheduler (triggers, dry run, budgets, overlap lock, missed-run policy, retries).
- **S19**: Kill switch + run history + unattended policy enforcement.

### M6 — Test Lab
- **S20**: Workbook import into rows (id, module, type, prompt, expected tools, expected behavior, ...).
- **S21**: Deterministic trace/text checks.
- **S22**: LLM judge + gold-set calibration.
- **S23**: Results table, diff vs previous run, pass rate per module, xlsx/JSON export, regression pack.

### M7 — Hardening
- **S24**: Auth, secrets encryption, budgets, audit log.
- **S25**: Embed mode (compact widget with same prompt box).
- **S26**: Packaging, docs, clean-clone setup.

### Deploy (final, on explicit approval, via composio CLI)
- **D1**: Create Vercel project (`VERCEL_CREATE_PROJECT2`).
- **D2**: Deploy (`VERCEL_CREATE_NEW_DEPLOYMENT`), poll `VERCEL_GET_DEPLOYMENT` to READY, report URL.

## Quality bar

Strict typing; unit tests for the loop, policy, coordinator, and scheduler; integration tests against
the simulator; architecture doc with a sequence diagram of a parallel subagent run.
