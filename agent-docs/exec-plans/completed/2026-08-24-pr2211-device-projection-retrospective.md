# PR 2211 Hosted Device Projection Round-Two Retrospective

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Original Requirement

Make existing route, hosted-device, and wearable failures truthful and directly
recoverable by the calling model without exposing submitted values, provider
bodies, credentials, local paths, or raw exception text. Device recovery must
distinguish known terminal correction from transient service failure without
adding another retry or state owner.

## First-Reviewed Design

The first-reviewed head projected hosted device failures through
`VaultCliError` and local `device_sync_*` codes. That design contained 447
authored-source additions and 76 deletions, or 523 lines of authored-source
churn. It missed the production hosted response-error family and therefore
collapsed real hosted failures into one generic retryable result.

## Round-One Remediation And Repeated Mechanism

The round-one correction replaced the local error-class gate with a structural
reader for the hosted HTTP response-error shape and added action-specific known
code allowlists. The current full patch contains 576 authored-source additions
and 91 deletions, or 667 lines of authored-source churn. The review remediation
delta contains 171 additions and 57 deletions, or 228 lines of authored-source
churn.

That correction fixed known HTTP 409 and 503 outcomes but changed the residual
generic result from retryable to terminal. The same underlying mistake
remained: one upstream transport error family was treated as the complete
assistant-facing failure contract. Pre-response timeout and network failures,
successful-response decoding failures, caller cancellation, and unknown
failures were not assigned semantics from the device action itself.

## Requirement-Level Decision

Continue the PR with a consolidation at the existing dynamic device-tool
projection boundary:

- Keep known response codes bounded and action-specific.
- Preserve explicit caller cancellation as a distinct terminal result.
- Treat non-cancellation residual failures for `list_accounts` as recoverable,
  because the action is read-only and replay-safe.
- Treat residual failures for `connect` and `reconcile` as ambiguous completion.
  Direct the model to run `list_accounts` and inspect current state before any
  retry, so an already-completed effect is not blindly duplicated.
- Delete competing generic retry semantics. Do not add another transport-class
  list, state owner, retry queue, reconciliation lifecycle, compatibility
  layer, or generic error framework.

The action and its effect semantics are the stable owner; transport classes are
only production-shaped evidence that every real failure family reaches that
single projection.

## Corrected Foundation Integration

The shared `VaultCliError` fourth argument and `repair` metadata were a second
error protocol rather than a necessary boundary. The correction deletes that
protocol and keeps `VaultCliError` at its existing stable three-argument shape:
code, message, and context. CLI envelopes project retryability and exit status
from safe scalar context and project bounded field errors only from
`context.issues`; they do not expose a renamed hint, stage, repair, guidance, or
recovery channel. Wearable reversed-date validation supplies one value-free
`to` issue through that existing context seam. Mapbox continues to use stable
codes and retryability without request-stage metadata.

The device dynamic tool remains an independent bounded tool-result projection.
Its local `code`, `message`, `retryable`, `stage`, and `hint` fields are not
carried by `VaultCliError`, and they encode the action-semantic retry decision at
the only assistant-facing device boundary.

## Direct Proof Required

Exercise the real chain from dynamic tool through the hosted runtime resolver,
device port, and control-plane transport. Cover a list timeout, network
failure, invalid successful response, known terminal 409, known transient 503,
action-mismatched code, explicit cancellation, and private sentinels. For
mutating actions, prove residual ambiguity instructs state inspection and never
blind retry.

## Completed Proof

The focused unit regression first demonstrated the reviewed failure: a
`list_accounts` transport failure projected `retryable: false`, even though the
read-only action is safe to replay. The corrected unit suite now covers known
codes, action-mismatched codes, missing upstream retryability, response-action
mismatch, caller cancellation, and all residual action branches.

The production-composed test uses the public device dynamic-tool seam, the
actual hosted runtime resolver, and the real hosted Web device-sync port. Its
nine cases cover list timeout, list network failure, invalid successful payload,
terminal reconcile 409, transient reconcile 503, a reconcile-only code returned
to connect, ambiguous connect, ambiguous reconcile, and explicit cancellation.
Every case verifies that a private sentinel is absent. Mutation residuals prove
one request attempt, `retryable: false`, and a current-state `list_accounts`
inspection instruction before any retry.

Focused verification completed:

- Typechecks passed for operator config, CLI, assistant engine, assistant
  runtime, and the Cloudflare runner.
- Operator-config error-contract tests passed: 12 tests.
- CLI projection, entrypoint, incur bridge, Mapbox, and address tests passed:
  137 tests; the wearable date-range recovery test passed in its six-test file.
- Assistant-engine device and public-wrapper tests passed: 39 tests.
- Assistant-runtime production-phase and package-entrypoint tests passed: 324
  tests.
- The hosted production-composed device test passed: 9 tests.
- The production runner bundle passed at 9,475,471 bytes against the 9,476,041
  byte Vault CLI budget, leaving 570 bytes without a budget ratchet. Runner
  entrypoint and static-closure budgets and parity probes also passed.

## Product UX Patch Walkthrough

- A model receiving a residual `list_accounts` failure sees a safe retryable
  result and can retry the read without guessing at transport details.
- A model receiving an ambiguous `connect` or `reconcile` failure is told to
  inspect current account state first, preventing blind duplicate effects.
- Caller cancellation stays terminal and does not become an accidental retry.
- A reversed wearable date range returns a field error for `to`, while submitted
  dates remain absent from the envelope.
- Mapbox failures retain stable error codes and retryability without a shared
  repair protocol or provider/request detail.

## Completed Plan

1. Traced the exact hosted error families and existing test seams through the
   composed production path.
2. Added a failing production-shaped integration proof for the current residual
   terminal disposition.
3. Consolidated projection around action semantics and removed the competing
   generic fallback contract.
4. Ran focused owner tests and affected typechecks and re-measured the production
   runner bundle before any budget decision.
5. Completed the Product UX Patch walkthrough. The remaining completion action
   is the workflow-owned plan archive and one local scoped commit, with no push
   or PR metadata change.
Completed: 2026-08-24
