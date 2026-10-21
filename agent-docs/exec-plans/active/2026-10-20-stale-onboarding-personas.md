# Reject retired persona selections before onboarding completion

Status: active
Created: 2026-10-20
Updated: 2026-10-20

## Goal and invariant

A stale onboarding client must not receive success for a persona it selected
when that selection would be silently replaced by Classic. Validate new saves
against the existing current selectable-persona predicate before any browser or
companion completion transaction. Preserve skip, valid Classic/tone/voice,
existing dials, auth, consent, idempotency and historical stored-data readers.

## Cause and smallest correction

The cached picker checks only successful completion and returns the originally
submitted selection. The shared completion parser used the historical storage
normalizer, accepting retired selections and substituting Classic before writes.
Use the existing current predicate for new input, returning the existing 400
error with refresh guidance. No new validation layer, migration, state or UI.

## Product UX

Outcome: reject false success before preferences, completion or mailbox writes.
Reaches: stale browser and installed-companion onboarding saves. Current valid
Classic saves and contact-only skip remain supported.
Proof: real shared parser through both route handlers, plus existing transaction
idempotency and contact-only flow tests. Cached clients display their existing
generic failure; a normal browser refresh loads contact-only onboarding. No
response can force an old cached client to display newly authored error copy.
Historical vault/mailbox normalization remains unchanged; retired features are
not restored and explicit tone, voice and dials remain effective.

## Dependency and coordination

PR #4243 independently owns temporary authenticated Web callbacks, strict wire
validation, bounded store application and Worker forwarding. This PR does not
duplicate those files. The release coordinator must combine eligible #4243 and
this guard before transitional Web promotion, then compatible Worker/runtime,
proven old-producer and in-flight-request drain, and later consumer removal.
Managed fresh-main Web admission remains required; no historical promotion.
Publisher #4240 remains separately owned. No production action is authorized here.

## Review history

This branch initially proposed Worker-only compatibility at ffa697de2ae2.
That implementation is removed from the resulting diff in favor of #4243.
Its first independent review failed during model selection before submission;
there was no accepted review or substantive PASS. The final guard candidate needs
a new full review and all required exact-head CI, preserving that attempt history.

## Verification and remaining work

- Tests-only reproduction: six failures; retired requests were accepted and the
  browser route returned 200.
- All 56 onboarding, contact-flow and settings tests pass after isolating the
  route tests' unused completion-writer dependency. The actual route and shared
  parser still execute; fail-on-use persistence stubs preserve the rejection
  boundary. Both route suites also pass all 22 tests under default parallelism
  in 19.60 seconds; the unchanged 60-second hook limit no longer fails.
- The archive proof initially detected stale generated changelog content.
  Regeneration through the existing owner restored all 10 passing archive tests;
  no production renderer or assertion change was needed.
- Lost Web typecheck/lint handles had no remaining worktree processes; one rerun
  of each is active with durable exit-code receipts. No success is assumed.
- Complexity debt remains zero, maximum 9 in the changed parser owner. Docs drift
  and diff checks pass.
- Pending: Web typecheck/lint, current-base mergeability, candidate review, new full
  independent review, exact-head CI and final plan closure. No merge or deployment.
