# Rollout Fence And Projection Latency

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Remove the two measured cold-reply latency taxes from the July 14 incident:
rollout-stale runtime fences that sleep after exact no-child proof, and
attachment-free non-email conversation input that waits for inbox projection.
For the projection-required path, stop opening terminal write-operation history
when only surviving staged operations can contain recoverable capture bytes.

## Success Criteria

- A recent prior-version runtime fence is replaced immediately only after its
  exact stored container target reports that no child is active.
- A recent same-version startup fence and every ambiguous liveness result remain
  fail-closed under the existing startup grace.
- Concurrent replacement callers converge on the authoritative fence record
  returned by the existing compare-and-swap instead of entering a timed retry.
- Attachment-free Linq, Telegram, and WhatsApp input reaches assistant
  admission without initializing or importing inbox projection.
- Direct email and attachment-bearing non-email input keep the synchronous
  projection behavior required for raw content and current-turn evidence.
- Group email remains raw-free and skips projection regardless of descriptors.
- Recovery lookup reads metadata only for operations with a surviving real
  staging directory; clean terminal history costs no per-operation file reads.
- Cross-shard canonical capture lookup remains unchanged because capture
  identity deliberately excludes the timestamp that selects the shard.
- No queue, lifecycle callback, new persisted state, dependency, service, or
  compatibility layer is added.
- Focused tests, required owner verification, specialist audits, CI, and the
  ReviewGPT PR loop are green with zero accepted findings.

## Constraints And Invariants

- UserRunner SQLite remains the sole durable runtime-fence owner.
- Replacement keeps exact attempt/generation compare-and-swap fencing and the
  pre-dispatch ownership confirmation.
- Direct wake and Temporal wake remain coalescing callers of the same owner.
- `AssistantInputEvent` staging remains the Codex admission boundary; inbox is
  attachment/search/debug enrichment, never a text-message admission gate.
- The active mailbox consumed-at lane has a broad assistant-runtime notice.
  Keep this change limited to conversation projection selection and its focused
  tests, and reconcile any actual overlap before push.
- Preserve all unrelated coordination rows and worktree changes.

## Decisions

- Bypass startup grace only for the direct `start-required/no-active-child`
  result when the exact wake target differs from the current version target.
- Feed compare-and-swap loser state and prepared-start ownership loss through
  the existing `ensureExistingRuntimeProcessing` path under the same budget.
- Delete the obsolete five-second replacement-race response and the Durable
  Object `state.waitUntil()` dependency; Cloudflare documents that method as a
  no-op and pending I/O already keeps the object active.
- Skip inbox preparation and import for attachment-free non-email input and all
  raw-free group email. Retain direct-email and attachment-bearing non-email
  projection, and treat an unknown descriptor count conservatively. Do not
  create deferred projection machinery.
- Use the existing write-operation staging directory as the recovery candidate
  set. Keep status and action validation after candidate selection; do not add
  an index, cache, concurrency pool, or expected-shard-only lookup mode.

## State

- The supplied runtime state proved this was not a rebuild: projection reported
  zero rebuilt captures and spent about 2.1 seconds preparing plus 4.6 seconds
  importing. The cold miss walked 1,465 inbox records and 247 terminal recovery
  operations before appending the new capture.
- The deletion-first implementation is complete on the TypeScript 7 `main`
  base that introduced TypeScript 7. Attachment-free non-email input skips
  projection; the existing synchronous owner remains for direct email and
  attachment-bearing non-email input. Final remote reconciliation remains part
  of the pre-push workflow because `main` continued to advance during review.
- Rollout recovery now reuses exact fence compare-and-swap plus the existing
  convergence path. No new lifecycle state or scheduler was introduced.
- Full owner verification, the security/privacy audit, and the initial coverage
  audit are green. The operation-recovery candidate gate is implemented and
  its focused owner verification is green.
- The cross-cutting invariant contract now records the projection-admission,
  staged-recovery, and exact-target rollout proof boundaries so future changes
  cannot silently restore either latency tax.

## Working Set

- `apps/cloudflare/src/user-runner/runtime-processing-controller.ts`
- `apps/cloudflare/src/user-runner/runtime-processing-responses.ts`
- `apps/cloudflare/src/user-runner/diagnostics.ts`
- `apps/cloudflare/src/user-runner/hosted-user-runner.ts`
- focused Cloudflare UserRunner tests
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- focused assistant-runtime conversation import tests
- `packages/core/src/operations/write-batch.ts` and public operation exports
- `packages/inboxd/src/indexing/persist.ts`
- `packages/inboxd/README.md`
- focused core write-operation and inboxd recovery tests
- `ARCHITECTURE.md`
- `docs/contracts/00-invariants.md`
- `packages/assistant-runtime/README.md`
- `agent-docs/references/hosted-runtime-protocol.md`

## Verification

- Focused assistant-runtime projection/document checks: 61 passed.
- Focused Cloudflare UserRunner suite: 84 passed; Cloudflare typecheck passed.
- Prepared workspace runtime artifacts with `pnpm build:test-runtime:prepared`
  and built assistant-runtime explicitly for the hosted-local test closure.
- Post-TypeScript-7 diff verification passed all 18 affected workspace
  typechecks and every architecture, dependency, boundary, crypto, and raw-log
  guard. The full affected-package test lane was attempted with bounded outer
  and Vitest concurrency; one unchanged assistant-engine filesystem-retention
  test timed out at 60.6 seconds while competing with one other file worker.
  The exact test passed independently in 36 seconds, and the two other
  load-shaped cases from the unbounded attempt also passed independently.
- Direct regressions cover prior-version exact-target replacement, same-version
  grace, compare-and-swap convergence, prepared-fence budget exhaustion,
  attachment-free projection omission, direct email, group email, links, and
  stale pending replay state.
- The supplied archive has 245 terminal operation metadata files and no stage
  candidates. Candidate selection changed from 245 metadata opens to zero; a
  ten-run warm local measurement changed from about 1,145 ms to about 2 ms for
  that operation-recovery enumeration.
- Core stage-candidate tests: 5 passed. Inboxd interrupted-write recovery tests:
  20 passed. Core and inboxd typechecks and 204 scenario-integrity checks passed.
- Required `security-privacy-review`: zero evidence-backed medium-or-higher
  findings. Initial required `coverage-write`: complete; it added one
  compare-and-swap convergence regression (UserRunner 85 passed).
- Required task-finish, recovery-gate, Cloudflare-semantics, security/privacy,
  deletion/minimality, and parent final diff/call-path reviews completed with
  zero unresolved production findings. Two documentation mismatches found by
  task-finish review were corrected before closure.
- Push, PR, CI, and ReviewGPT loop: pending.
Completed: 2026-07-14
