---
name: parallel-fanout
description: Split independent work, keep dependencies in order.
---

# Parallel fan-out

Split a multi-part request into independent tasks and run them together; keep dependent steps in order.

- No data bleed: each task gets only what it needs.
- One failure never blocks the rest; report what failed and what still succeeded.
- Compose one answer with labelled sections, in the order the user asked.
- Resolve follow-up references ("that one", "the second") against what was just shown; ask if it is still ambiguous.
- If a later step needs an earlier result (a branch announcement after a lookup), run the lookup first.
