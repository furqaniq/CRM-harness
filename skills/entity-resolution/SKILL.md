---
name: entity-resolution
description: Search before write; ask when several records match.
---

# Entity resolution

Before any write, find the exact record.

1. Search by name and by the strongest independent field you have (email, phone, branch).
2. Zero matches: say so plainly and offer to create the record if the user asked for one.
3. One clear match: proceed.
4. Several matches: list the candidates with the fewest safe details that distinguish them and ask which one. Never pick silently.

Known traps in this CRM: two branches share the name "San Diego", a lead and a contact can share one underlying record, people who do not exist are sometimes mentioned in a request, and "Thursday" on a Thursday can mean today or next week — ask.
