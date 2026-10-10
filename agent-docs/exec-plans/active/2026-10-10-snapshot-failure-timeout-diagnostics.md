# Preserve snapshot failure diagnostics for supported timeouts

Status: active
Created: 2026-10-10
Updated: 2026-10-10

## Goal

Preserve the existing closed snapshot failure phase and valid timeout diagnostic when a supported runtime deadline exceeds one minute. This is internal telemetry only; checkpoint and recovery behavior stay unchanged.

## Success criteria

- Synthetic lifecycle proof exposes the omitted fields at the base and passes after the correction.
- Existing short-timeout, absent-timeout, invalid-value, and unknown-phase privacy boundaries remain covered.
- ReviewGPT authors the correction; focused tests, relevant typecheck, privacy/docs/complexity checks, final ReviewGPT, and required exact-head CI pass.
- Any telemetry-only rollout uses the canonical compatible release path and is verified read-only; natural exercise remains pending when absent.

## Scope and constraints

Use the existing snapshot failure parser, fields, and log event. No new events, I/O, state, deadline, retry, cancellation, provider, or control policy changes. Keep all examples synthetic and public-safe. Separate the diagnostic omission from the unresolved reason a snapshot operation stalled.

## Evidence and decisions

The runtime accepts finite positive commit deadlines. The failure producer annotates a closed phase and timeout, while the consumer rejects the entire annotation above 60,000 milliseconds. The existing lifecycle regression modified only to use 120,000 milliseconds fails with both fields absent. Current snapshot timeout/cancellation tests pass (8 selected); instant-first-turn owner tests independently pass (47). Relevant open PR diffs do not change this diagnostic owner; adjacent vault-share test imports can coexist.

## Tasks

1. Have ReviewGPT author the minimal correction, focused synthetic tests, and owner documentation.
2. Inspect the candidate and prove before/after behavior plus privacy and unchanged error propagation.
3. Commit, push a draft PR, review the candidate, then run final ReviewGPT concurrently with required CI.
4. Close the plan, assess telemetry-only merge/deployment authority, and preserve the exact natural observation query.

## Risks and mitigations

Numeric validation must not leak arbitrary error properties or invent a timeout. Preserve the fixed phase allowlist and safe-number validation. A valid phase should not disappear merely because an optional duration is malformed; tests must prove the intended contract. Never equate richer telemetry with recovery of the original snapshot obligation.

## Verification

Baseline diagnostic reproduction: 1 failed, 78 skipped in hosted-invocation-bridge.test.ts, with expected phase and 120,000 millisecond timeout missing. The temporary test modification was restored before authoring. ReviewGPT authored the correction and 30 synthetic cases. The new cases on unchanged source produce 12 failures and 18 passing controls; the corrected full bridge suite passes 109 tests. Package typecheck, log privacy guard, docs drift, and complexity guard pass. The three reported file hotspots are unchanged orchestration/appender functions (56/25/24); the parser correction removes four net source lines and requires no broader refactor. Docs gardening passes with zero issues. External completion gates remain pending.
