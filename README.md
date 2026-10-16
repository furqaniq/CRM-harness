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
  app/          Next.js routes, layout, design tokens (globals.css)
  core/         Agent loop, events, tools, policy, planner, routines (library)
  design/       Design tokens mirrored in TS, enforced by tokens.test.ts
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
- **Prompt box is visual-only.** The glowing ring, pills and send button render, but sending and
  stopping a run arrive with the core loop in S5 (M1).
- **Token meter shows sample values** (`1,310 / 2,811`) until per-run cost and token accounting land
  in M1.
- **Agents, Skills, Loops, MCP, Providers, Runs, Test Lab and Settings routes are placeholders**
  (each states the milestone it arrives in). Chat/ and the shell are live.
- **Vercel vs. long-running work.** The interactive harness will deploy to Vercel. The scheduler
  (M5, 15-minute loops and cron routines) needs always-on execution that Vercel Cron cannot provide
  on its own — to be resolved or recorded as a gap at the M5 gate.
- **Branch switcher, language picker and search (Ctrl K) are inert** until their milestones land;
  Ctrl K focuses the search field but searching itself is not wired.
