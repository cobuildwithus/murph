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
- Treat hosted WhatsApp transport loss after provider entry as terminally
  ambiguous while preserving explicit HTTP rejection and pre-entry proof.
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
- `packages/operator-config/src/whatsapp-runtime.ts`
- `packages/operator-config/test/runtime-helpers.test.ts`
- `packages/operator-config/test/whatsapp-runtime.test.ts`
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
- Shared JSON transport proof that Linq and WhatsApp cannot erase the same
  explicit no-egress marker.
- Existing generic Telegram ambiguity and exact outbox restoration regressions.
- Exact non-idempotent Linq claim release before local restoration, including
  release-conflict ambiguity and one successful retry.
- Hosted WhatsApp pre-entry restoration, post-entry transport ambiguity, and
  explicit HTTP-response retry behavior.
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
- Transport audit: raw WhatsApp response loss, including caller abort after
  provider entry, could be retried. Keep it terminally ambiguous while
  preserving explicit HTTP-response semantics and exact pre-entry proof.
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

- Shared-host focused verification: assistant-engine retry policy 5/5;
  assistant-runtime callbacks and channel activity 224/224; Cloudflare runner
  platform 125/125; Web engagement, delivery route, and store 142/142; operator
  runtime helpers and WhatsApp 36/36.
- Coverage proves the same claim-attempt timestamp flows from the runtime
  request through Web persistence and exact release CAS, including invalid-
  timestamp rejection and timestamp-mismatch conflict.
- Control-plane invalid JSON and body-read failure are marked response-
  unavailable; caller-aborted WhatsApp transport remains terminally ambiguous.
- Scoped `git diff --check` is green. Final exact-head typechecks, verification,
  bundle assembly, CI, and ReviewGPT remain required after latest-main lineage
  reconstruction.
