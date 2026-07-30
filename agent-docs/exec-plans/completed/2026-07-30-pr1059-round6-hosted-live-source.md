# Close the PR 1059 hosted live-source race

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Preserve Web's hosted device-source rows as the authoritative import
  admission state throughout an in-flight Junction pull.
- Keep the provider-owned per-projection admission check and the existing
  SQLite behavior for local runtimes.
- Prove both absent and stale-connected runner state cannot admit a source
  disconnected in Web while a connected sibling continues.

## Evidence

- ReviewGPT Round 6 traced hosted job-time `listConnectionSources` calls to the
  runner SQLite store.
- Hosted maintenance hydrates that store from Web once before scheduling and
  draining jobs, so a later Web disconnect is not visible to those job-time
  reads.
- A missing local source row is deliberately legacy-compatible and admitted,
  making either absent or stale-connected runner state unsafe at this boundary.

## Tasks

1. [x] Add a production-composed hosted regression test that disconnects a
   target source in Web while a Junction request is in flight.
2. [x] Route hosted job-time source reads through the existing Web runtime
   snapshot port without copying the result back into SQLite.
3. [x] Fail closed when the hosted connection mapping or authoritative Web
   snapshot cannot establish the current source state.
4. [x] Run focused provider, service, hosted-runtime, and boundary verification.
5. [x] Complete the parent diff review and close this implementation plan
   before the exact-head final gates.

## Post-plan merge gates

- Push the remediation and update the PR evidence.
- Run exact-head CI and ReviewGPT Round 7 concurrently.
- Require a final exact-head `PASS` plus green required checks before merge.
- Confirm the merge, then retire the clean inactive task worktree.

## Verification

- The new hosted race regression failed before the source-reader correction:
  both an absent runner source and a stale-connected runner source imported
  records after Web disconnected the target in flight.
- The corrected regression passes for account summaries and two-window
  timeseries imports, preserves the connected sibling, avoids duplicate local
  source identities, and admits the target after Web reconnects it.
- A missing authoritative hosted connection prevents import and leaves the job
  queued with a retryable source-state diagnostic.
- Device-sync provider/service tests: 315 passed.
- Assistant-runtime hosted source/service/maintenance tests: 158 passed.
- Device-sync and assistant-runtime scoped typechecks passed.
- `git diff --check` passed.
Completed: 2026-07-30
