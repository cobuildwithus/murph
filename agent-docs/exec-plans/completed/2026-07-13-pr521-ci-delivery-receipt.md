# PR 521 CI delivery receipt follow-up

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Close PR 521's exact-head CI regressions without restoring unsafe no-op event
  returns, then resume exact-head ReviewGPT and merge only when every gate is
  green.

## Success criteria

- Protected and stale device imports return no canonical events while their
  durable vault owners remain unchanged.
- A meaningful raw-only Junction delivery can prove historical coverage after
  both its first write and an exact lost-ack replay.
- Id-only or otherwise unhelpful raw input cannot prove historical coverage.
- Importer coverage, core/device-sync tests and typechecks, required completion
  audits, exact-head ReviewGPT, and GitHub required checks pass.

## Scope

- In scope: device-sync receipt projection,
  Junction historical-evidence gating, stale importer assertions, focused
  regression tests, and the matching durable invariant.
- Out of scope: new persistence, queues, indexes, provider polling changes, or
  unrelated hosted-runtime behavior.

## Constraints

- Technical constraints: derive acceptance from the existing integration-ingest
  owner; never infer a canonical event from an unrelated current owner.
- Product/process constraints: preserve user edits, tombstones, newer provider
  revisions, raw evidence, and the source/resource historical coverage model.

## Risks and mitigations

1. Risk: a generic accepted-delivery bit could let id-only webhook payloads
   falsely complete history.
   Mitigation: require both durable acceptance and the existing Junction
   resource-specific usefulness predicate before adding coverage evidence.
2. Risk: updating stale tests could hide a real vault-state regression.
   Mitigation: assert the protected durable record/revision directly and assert
   the no-op result has no returned events.

## Tasks

1. Add focused failing receipt/replay proof at the device-sync owner.
2. Project one explicit durable-delivery acceptance fact after a successful
   core import and gate Junction raw-only coverage on semantic usefulness.
3. Update stale no-op assertions to the safer result contract while retaining
   direct durable-state checks.
4. Run focused and full verification, completion audits, ReviewGPT, exact-head
   CI, and merge.

## Decisions

- Keep canonical event count and durable delivery acceptance separate; neither
  substitutes for the other.
- Add no durable state or new service. The new receipt is a transient fact
  derived after the existing core import owner returns successfully.

## Verification

- `pnpm --dir packages/importers test:coverage` (355/355 passing).
- `pnpm --dir packages/device-syncd test:coverage` (784/784 passing).
- Both affected package typechecks pass.
- Required coverage-write and security/privacy completion audits found no
  remaining findings; the coverage pass added only focused tests.
- `pnpm test:diff` passes its guards and reaches affected workspace typechecks,
  then stops at the unchanged `packages/hosted-execution` test import failure
  for `@murphai/hosted-execution/clinical-records`.
- Exact-head ReviewGPT and GitHub required checks remain external gates before
  merge.
Completed: 2026-07-13
