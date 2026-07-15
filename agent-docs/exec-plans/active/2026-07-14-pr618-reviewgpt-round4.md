# PR 618 ReviewGPT Round 4 Fix

## Goal

Preserve proven pre-provider authority yields across channel adapters so an
unprepared durable reply restores its prior outbox dispatch state instead of
becoming terminally abandoned as an ambiguous send, while keeping coupled
provider-claim state and post-entry ambiguity fail-closed.

## Constraints

- Preserve the original error object only when it explicitly proves
  `deliveryMayHaveSucceeded: false`.
- Keep generic Telegram socket, timeout, parse, and provider failures ambiguous
  so automatic retry cannot duplicate a send.
- Cover text, image, and voice-memo adapter paths without adding a hosted-runtime
  dependency to assistant-engine.
- Reuse the existing hosted no-egress marker and outbox restoration owner; add
  no persisted state, retry owner, queue, or transport abstraction.
- Release an exact unused non-idempotent Linq provider claim through its
  existing Web-owned outcome boundary before restoring local dispatch state;
  retain conservative ambiguity if that release cannot be proven.
- Adopt latest `main`'s deletion of the retired channel without resurrecting
  its runtime, tests, or transport-specific policy.
- Keep PR 618 open; do not merge or deploy.

## Working Set

- `packages/assistant-engine/src/assistant/channels/runtime.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- `packages/assistant-engine/test/assistant-channels-runtime.test.ts`
- `packages/assistant-engine/test/outbox-dispatch-state.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/test/hosted-runtime-channel-activity.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `packages/operator-config/src/assistant/delivery-failure.ts`
- `packages/operator-config/src/http-json-retry.ts`
- `packages/operator-config/test/runtime-helpers.test.ts`
- `apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts`
- `apps/web/app/api/internal/hosted-runtime/linq-egress/engagement/route.ts`
- `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts`
- Focused hosted Linq egress route/store tests.
- `agent-docs/references/hosted-runtime-protocol.md`
- Focused outbox/runtime tests only if the production seam needs additional
  proof beyond the existing exact-state restoration coverage.

## Verification Plan

- Reproduce the current ambiguous wrapping at the real hosted Telegram adapter
  boundary, then prove identity-preserving rethrow after the correction.
- Focused text, image, and voice-memo adapter coverage plus the real hosted
  asynchronous provider-entry fence.
- Shared JSON transport proof that an explicit no-egress marker is preserved
  by identity.
- Existing generic Telegram ambiguity and exact outbox restoration regressions.
- Exact non-idempotent Linq claim release before local restoration, including
  release-conflict ambiguity and one successful retry.
- Affected package typechecks and owner suites, required coverage-write and
  security/privacy refreshes, parent final review, exact-head CI, and ReviewGPT
  rerun to zero accepted findings.

## Accepted Findings And Corrections

- Round 4 ReviewGPT: Telegram text, image, and voice adapters erased exact
  no-egress proof. Preserve only explicit `deliveryMayHaveSucceeded: false` by
  identity; generic provider failures remain ambiguous.
- Owner audit: an acknowledged non-idempotent Linq claim could survive a later
  pre-provider yield. Release the exact web-owned claim before local restore;
  missing proof remains terminally ambiguous.
- Coupled-state follow-up: an unavailable Linq claim response could leave the
  durable claim consumed without a provider call. Capture claim-attempt proof,
  persist that exact attempt timestamp with the web-owned claim, require it in
  the release compare-and-set for marked control-plane response loss, and
  exclude definitive web rejections and known existing claims.
- Latest-main adoption: the retired channel was deleted upstream. Accept that
  deletion and remove the branch's transport-specific implementation and
  tests rather than preserving dead behavior. Keep the generic
  non-idempotent ambiguity invariant proved with a supported channel.
- Complexity collapse: derive ambiguous non-idempotent outbox handling from the
  existing transport-idempotence fact and delete channel-specific allowlists.

## Review Lineage And Round 5

- Immutable first-reviewed head:
  `0b7007d4ed4185e2bb2ee8602e2c5643d149668b`.
- Previous reviewed head:
  `6c2e7cb54131ecd7eab977ae0466092469681a28`.
- Reconstruct ordinary Git ancestry from the previous reviewed head, retain the
  first-reviewed head as an ancestor without changing the newer tree, then
  normally merge latest `main`. Do not rebase away reviewed lineage.
- The requested ReviewGPT prompt upgrade is contained in
  `ffefbb210813975c42346d3cf7012b30abc6bb32`; latest `main` must contain it.
- Round 5 is correction scope. Start it immediately after the exact final head
  is pushed and the PR body carries the immutable baseline, current shape, and
  retrospective. Do not cancel or restart any existing run.

## Anomaly Retrospective

Decision: continue this PR with a strict scope freeze. Every correction enforces
the same final-provider-entry/no-egress invariant at an existing owner: runtime
phase authority, local outbox state, the web-owned Linq delivery claim, and the
channel transport adapter. The delta adds no durable owner, queue, scheduler,
lease, migration, repair pass, or reconciliation loop. It deletes duplicate
route identity and channel-specific ambiguity policy. Any further finding from
the same mechanism or any requested expansion outside this direction requires
a new requirement-level continuation decision; there is no automatic Round 6.

## Evidence So Far

- Shared-host focused verification passed across the corrected owners:
  assistant-engine retry policy 5/5; assistant-runtime callbacks and channel
  activity 224/224; Cloudflare runner platform 127/127; Web engagement,
  delivery route, and store 142/142; operator runtime helpers 30/30; the
  current prompt-budget assertion 1/1; combined runtime callbacks and
  workspace entrypoint 408/408; and current Web Linq engagement 37/37.
- Coverage proves the same claim-attempt timestamp flows from the runtime
  request through Web persistence and exact release CAS, including invalid-
  timestamp rejection and timestamp-mismatch conflict.
- Control-plane invalid JSON and body-read failure are marked response-
  unavailable. Latest `main` removed the retired channel, and the merge keeps it
  deleted.
- Latest `main` at `fd2929469a57529307ab5638adf48091fd92199d` is merged at
  `b84600890a29dd6edf3e025a13fea2d70b58e6ef`. The prompt-upgrade commit, first
  reviewed head, and previous reviewed head remain ancestors. A semantic audit
  found the latest Junction historical-coverage work disjoint from this PR's
  wake, provider-entry, outbox, and Linq owners.
- Shared-host `pnpm verify:acceptance` at `6c35a39fcce51f37b0ee2e126336aa484cfc2597`
  passed every pre-coverage gate, including dependency policy, workspace
  boundaries, hosted guards, runtime-artifact preparation, TypeScript 7
  workspace typecheck, docs, and artifact hygiene.
  Package coverage then reported three host-resource failures: one CLI test
  exceeded its coverage-mode timeout, one assistant-engine worker timed out
  during fork termination, and one assistant-runtime worker exhausted its V8
  heap. The exact CLI test passed under coverage in 36.72 seconds (the focused
  command then failed only the intentionally unexercised package-wide coverage
  thresholds); the assistant-engine file passed 87/87 without coverage; and the
  full assistant-runtime no-coverage suite passed 73 files and 1,702 tests with
  two skipped. The assistant-engine focused coverage worker independently
  reproduced the V8 heap limit before coverage collection, confirming the
  remaining coverage blocker is resource-bound rather than an assertion.
- The current-source Cloudflare runner bundle rebuilt all workspace artifacts
  and assembled within budget: entry 937,577 B, static boot closure 6,888,343 B,
  and total 8,861,630 B. The requested fresh-artifact assemble-only rerun also
  passed with the same bundle sizes.
- Scoped `git diff --check` is green. Final parent review, privacy/prohibited-
  cast/generated scans, exact-head CI, and ReviewGPT Round 5 remain required.
