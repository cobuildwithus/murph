# PR 2211 device response mismatch

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Make the already-detected hosted device response-action mismatch distinguishable
from an unclassified operation failure without changing device effect semantics.
Keep the route lookup failure contract aligned with the reviewed foundation so
caller cancellation cannot be mistaken for a retryable timeout.

## Evidence

- `executeDeviceDynamicTool` checks the returned action against the requested
  action, then reports the generic residual code.
- A mismatched response is a bounded host/device contract failure. The caller
  currently cannot distinguish it from transport or provider failure.

## Design

- Return stable code `device_response_mismatch` and a precise bounded message.
- Keep `list_accounts` replay-safe. Keep `connect` and `reconcile` non-retryable
  until `list_accounts` establishes current state because completion is unknown.
- Add direct proof for every requested action; expose neither returned action nor
  response payload.

## Tasks

1. Add the owner-local mismatch projection and three-action tests.
2. Run focused tests, typecheck, package/bundle gates, diff/privacy inspection.
3. Commit, push the Draft candidate, refresh PR evidence, and rerun exact-head
   review because the previous round covered the preceding head.

## Progress

- All three requested actions now return `device_response_mismatch`; only the
  read-only list action is replayable without first inspecting current state.
- Focused device-tool tests pass 21/21 and assistant-engine typecheck passes.
- Documentation drift and gardening gates pass; diff/privacy inspection passes.
- Production runner assembly and all eight parity probes pass. Vault CLI total
  is 9,464,449 / 9,476,041 bytes with 805-byte entry and 25,155-byte static
  closure. Runner total is 11,279,228 / 11,393,617 bytes with 1,740,666-byte
  entry and 8,604,433-byte static closure.
- The foundation review proved that the existing route owner still treated
  caller cancellation as retryable and omitted the model-facing transport or
  response stage. The owner now matches the foundation byte-for-byte:
  cancellation is terminal, timeout and ordinary transport failures are
  retryable, finite HTTP classes expose `response`, and no retry loop or state
  was added.
- Focused source and prepared route suites pass 42/42; CLI typecheck and docs
  gates pass.
- Production runner assembly and all eight parity probes pass after the route
  alignment. Vault CLI total is 9,465,037 / 9,476,041 bytes with 805-byte entry
  and 25,155-byte static closure. Runner totals remain 11,279,228 / 11,393,617
  bytes with 1,740,666-byte entry and 8,604,433-byte static closure.
