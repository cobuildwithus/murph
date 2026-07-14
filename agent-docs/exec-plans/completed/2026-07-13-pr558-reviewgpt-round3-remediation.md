# PR 558 ReviewGPT round 3 remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Preserve a runnable local system-mailbox continuation when retention-only
  maintenance imports but intentionally does not handle system work.
- Keep inactive group-leave acknowledgements retryable across both cleanup-wake
  and provider-delivery failures without replaying the membership mutation.
- Finish PR #558 on current `main` with focused/full verification, guarded push,
  exact-head CI, and a zero-accepted-finding ReviewGPT round.

## Accepted findings and required outcomes

1. Retention-only system import must merge the existing pending-system wake
   candidate into both the persisted checkpoint and returned invocation wake.
2. A failed inactive cleanup signal must not suppress the deterministic leave
   result attempt; the signal error remains retryable after delivery is tried.
3. Consumed leave evidence must derive its current read-only outcome from group
   state: preserve missing-group and owner results, confirm a departed or absent
   membership as already left, and suppress stale delivery after explicit
   non-owner rejoin. It must never call the leave transaction again.

## Scope

- Assistant-runtime retention-only checkpoint wake selection and focused tests.
- Web group-store replay outcome lookup, inactive Linq leave planning, webhook
  post-handoff ordering, and focused tests.
- No new database state, queue, scheduler, mutation owner, assistant/model work,
  read receipt, or generic inactive-runtime permission.

## Tasks

1. Reuse `resolveDeferredMailboxImportSystemMailboxWake` in retention-only
   checkpointing and cover the imported-but-unhandled continuation.
2. Add a read-only group-store replay outcome resolver and use it for consumed
   inactive leave evidence while preserving rejoin suppression.
3. Attempt post-handoff results after a cleanup signal failure, then rethrow the
   signal error so durable cleanup latency remains retryable.
4. Run focused and full required tests/typechecks/guards, finish the scoped
   commit, push with an exact remote-head lease, and rerun ReviewGPT with CI.

## Verification

- Focused Web leave/store/mailbox tests: 141 passed.
- Assistant runtime focused suites: 311 passed; one concurrent harness timeout
  passed alone in 189 ms.
- Assistant engine automation suite: 154 passed.
- Full Web suite: 4,948 passed, 135 skipped; lint completed with warnings only.
- Web production build and Web/runtime/engine typechecks passed.
- Web dev smoke passed alone with the repository prepared-local-env harness.
- Docs drift, Temporal orchestration, scenario integrity, dependency, workspace
  boundary, stale-name, crypto, and raw-log-payload guards passed.
- `test:diff` completed every affected-app leg except its concurrently launched
  dev smoke, which timed out after the server reached ready and passed alone.
Completed: 2026-07-13
