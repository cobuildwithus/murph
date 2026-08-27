# PR 2211 device response mismatch

Status: completed
Created: 2026-08-24
Updated: 2026-08-27

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
- Keep `configure_no_data_outreach` effect-once: any mismatch, unreadable
  post-effect response, unclassified failure, or cancellation reports unknown
  completion and requires fresh private member input. It never suggests
  `list_accounts` or a same-message retry.
- Delete the two PR-added global absolute-path replacements. Preserve each
  existing diagnostic owner's established output instead of broadening a
  shared sanitizer.
- Add direct proof for every requested action; expose neither returned action nor
  response payload.

## Product UX Patch

- Outcome: Murph does not repeat a no-data outreach preference change when the
  first attempt may already have taken effect.
- Reaches: the current private-member device preference journey when the host
  response is mismatched, unreadable, failed, or cancelled.
- Proof: focused tests show one effect attempt, terminal recovery that requires
  fresh private input, and no request, response, error, or path-value echo.

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
- Integrated current `main` in merge candidate `12b08e32e8`, retaining the
  main-owned shared projector and composing only the device, wearable, route,
  and retry-aware elevation allowance. The resulting PR domain diff is 26 files
  with no duplicate foundation implementation.
- Current-main focused proof passes: 335 assistant-engine/runtime device tests,
  77 CLI route/wearable tests, 89 health-metrics/operator/inbox wrapper tests,
  and 14 runner bundle-guard tests. Affected assistant-engine,
  assistant-runtime, CLI, health-metrics, and query typechecks pass.
- Prepared runtime, CLI package shape, documentation drift/gardening, and the
  canonical production runner assembly pass. The assembled Vault CLI is
  9,520,965 / 9,527,848 bytes with an 805-byte entry and 25,155-byte static
  closure; the runner is 11,352,549 / 11,393,617 bytes with a 1,751,100-byte
  entry and 8,659,263-byte static closure. All eight parity probes pass.
- Parent review accepted two owner-local corrections before remediation: keep
  cancellation terminal when it arrives during optional elevation sampling,
  and move the production device-port proof into current main's split
  device-sync test instead of retaining the deleted test monolith.
- The corrections add one explicit cancellation rethrow and relocate existing
  test proof; they add no runtime abstraction, state, compatibility layer, or
  duplicate error map.
- On the current-main merge candidate, the 28 focused route tests, nine split
  production-device assembly cases, CLI and assistant-runtime typechecks,
  prepared runtime build, and CLI package-shape check pass.
- Canonical production assembly passes all eight parity probes. The Vault CLI
  is 9,521,301 / 9,527,848 bytes with an 805-byte entry and 25,155-byte static
  closure; the runner is 11,369,410 / 11,393,617 bytes with a 1,753,568-byte
  entry and 8,662,171-byte static closure.
- Final ReviewGPT accepted two narrow corrections: remove the PR-added global
  absolute-path scrubber branches, and preserve the effect-once
  `configure_no_data_outreach` contract through mismatch and residual failure
  projections. Remediation stays within the existing shared diagnostic owner
  and device projector; it adds no sanitizer, retry owner, protocol, or state.
- The effect-once correction is complete. Mismatch, oversized post-effect
  response, pre-response failure, and cancellation each make one request,
  expose no synthetic request/response/error values, omit `list_accounts`, and
  require fresh private input before another preference change.
- Focused proof passes: 49 assistant device/domain-tool cases, 28 route cases,
  10 inbox diagnostic-owner cases, and five operator-config contract cases.
  Assistant-engine, inbox-services, and operator-config typechecks pass.
- Product UX walkthrough passes for the affected private-member failure paths;
  existing list, connect, reconcile, and successful preference behavior is
  unchanged. Diff whitespace and added-line privacy scans pass.
- Integrated merged knowledge-recovery foundation `d3d01885c2` into candidate
  `0431a0c97a`. The only conflicts were the obsolete absolute bundle budget and
  its unit test; both now reuse `main`'s relative first-parent budget unchanged.
- Merged-tree proof passes: 176 focused device, route, wearable, health-metric,
  and bundle-guard tests; assistant-engine, assistant-runtime, CLI,
  health-metrics, query, and Cloudflare typechecks; prepared runtime build;
  generated CLI schema/hash currentness; CLI package shape; and diff whitespace.
Completed: 2026-08-27
