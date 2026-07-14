# PR 558 ReviewGPT Round 8 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve join-confirmation membership fencing through durable outbox delivery and make inactive-group leave acknowledgements restart-safe after a committed provider-dispatch claim.

## Success criteria

- Queue-only join confirmations revalidate their persisted membership epoch immediately before provider delivery and durably stop when stale.
- Inactive-group leave result replay uses a stable acknowledgement body and can safely reclaim an unresolved pre-provider claim.
- Focused tests, affected typechecks, CI, and a fresh exact-head ReviewGPT audit pass.

## Scope

- Existing assistant outbox intent/preflight, hosted membership epoch callback, inactive leave reply/claim behavior, and focused tests.
- Excludes hosted-local stub scoping, unrelated PRs, and PR merge.

## Constraints

- Reuse existing outbox and Linq delivery owners; add no queue or worker.
- Keep all irreversible effects behind current route and membership validity checks.

## Tasks

1. Trace and prove both round-8 findings against current durable paths.
2. Implement the smallest typed validity/reclaim corrections with regressions.
3. Verify, finish-plan commit, guarded-push, and run CI plus exact-head ReviewGPT concurrently.

## Verification

- Focused outbox notification, callback, Linq planner/transport/store tests.
- Affected package typechecks and diff verification.
- Exact pushed-head CI and ReviewGPT 0.5.106 Pro/current audit.
Completed: 2026-07-14
