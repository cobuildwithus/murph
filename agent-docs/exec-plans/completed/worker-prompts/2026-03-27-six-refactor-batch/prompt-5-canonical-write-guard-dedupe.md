You are Codex Worker W5 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `AGENTS.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Use the pre-registered ledger row `codex-worker-canonical-write-guard-dedupe`; update it if scope shifts, and remove it before finishing.
- Keep this behavior-preserving: do not weaken the guard, do not change the error code/message contract, and do not change which files are considered canonical/protected.

After changes:
- Run the narrowest truthful tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Simplify `packages/cli/src/assistant/canonical-write-guard.ts` by removing its duplicated knowledge of core write-operation metadata and protected-path policy.

Relevant files/symbols:
- `packages/cli/src/assistant/canonical-write-guard.ts`
  - `executeWithCanonicalWriteGuard`
  - `applyCommittedOperationEffects`
  - `recoverStoredWriteOperationForGuard`
  - `parseRecoverableStoredAction`
  - `resolveCommittedPayload`
  - `listProtectedCanonicalPaths`
  - `isProtectedCanonicalPath`
- `packages/core/src/operations/write-batch.ts`
  - `StoredWriteOperation`
  - `readStoredWriteOperation`
  - internal stored-action parsing if a shared tolerant reader is the cleanest home

Regression anchors to preserve:
- `packages/cli/test/assistant-service.test.ts`
  - audited committed writes stay allowed
  - direct writes still roll back
  - malformed metadata still yields `ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED`
  - impossible committed payloads still block
  - guard error still wins over simultaneous provider errors
  - large text/jsonl and delete-preservation cases

Best-guess fix:
1. Move the tolerant recoverable stored-write parsing into `@murph/core` and consume it from the guard.
2. Centralize the protected canonical path predicate so listing and checking share one rule source.
3. Delete the duplicated local schema/policy logic without changing precedence rules.

Overlap notes:
- `packages/cli/src/assistant/canonical-write-guard.ts` overlaps an active assistant guard lane.
- `packages/core/src/operations/write-batch.ts` has nearby inbox/core mutation edits. Read both files carefully and preserve unrelated changes.

