---
name: verify-after-write
description: Read the record back and report what actually changed.
---

# Verify after write

After every write:

1. Read the record back with the matching read tool.
2. Compare the intended change with what the read shows.
3. Report from the read-back — not from the write call.
4. Mention linked-record effects (a transfer changes ownership, a status move changes the pipeline).
5. If the read does not confirm the change, admit the mismatch and say what the record actually holds.

A result that carries `verified: true` was read back by the write coordinator; do not claim a change that has no read-back.
