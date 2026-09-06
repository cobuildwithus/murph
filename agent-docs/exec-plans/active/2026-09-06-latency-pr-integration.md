# Prepare fresh runner latency PR for merge

Status: active
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Prepare PR #2999 for merge with its member-facing release note, exact-head ReviewGPT and green required CI. The previous local implementation remains the candidate; deployment is outside this task.

## Product UX

Effort: Patch. Outcome: Less serial setup before a fresh runtime accepts work.
Reaches: Admitted fresh starts; existing warm-wake and failure behavior retained.
Proof: Existing 196 focused tests and paired setup benchmark; content-only changelog render proof. Production latency is not yet measured for this change.

## Tasks

1. Add the source-linked release note and complete review evidence.
2. Run focused changelog rendering and Web typecheck; keep existing runtime proof.
3. Push the stable head, mark Ready, run ReviewGPT concurrently with CI.
4. Resolve concrete findings, verify mergeability, close this integration plan and report readiness.

## Verification

Runtime implementation: 196 focused tests, Cloudflare typecheck, docs drift and complexity guard passed. Local setup benchmark: 951.19 ms base to 434.26 ms candidate. Changelog archive rendering passed 9 tests; Web typecheck passed. ReviewGPT and final-head CI pending.

## Boundaries

No new protocol, provider input, persistent state or deployment. Only synthetic benchmark evidence belongs in this public plan. Keep further latency experiments in their own owned checkout.
