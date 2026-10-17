---
name: validate-against-company-lists
description: Only real statuses, sources, loan types and stages.
---

# Validate against company lists

Before setting any field from a fixed list — status, source, loan type, stage — read the company's valid values first.

- If the requested value exists, use it.
- If it does not, do not invent one. Say the value is not in the company's list and name the closest real value (or list the valid ones if there is no close match).
- Never write a guessed value "to fix it later".

Statuses, sources, loan types and stages are checked names, not free text.
