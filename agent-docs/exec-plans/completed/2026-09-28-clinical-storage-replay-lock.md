# Serialize clinical storage selection and replay

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

Final review of PR #3767 found that explicit image minimization could replace raw
bytes after an import retry selected them but before its immutable batch checked
them. That race could reject a valid snapshot and end the retrieval checkpoint.

Reuse the existing canonical write lock continuously from retained-byte selection
through raw publication. Keep original provider identity, receipt verification,
immutable-match checks and canonical event import behavior unchanged. No new
state, retry mechanism or concurrency owner is needed.

Controlled concurrent execution tests cover both the first minimization and a
second repair of already-minimized HTML. They pause the actual public reader at
the selection/publication boundary, prove the canonical lock remains active and
the repair waits, then verify both operations and an original-provider replay.
The 40 execution/storage tests and vault typecheck passed. PR #3767 owns final
exact-head review and CI after updating its dependency. Hold before merge at the
user's request; no hosted vault cleanup or deployment is part of this commit.
Completed: 2026-09-28
