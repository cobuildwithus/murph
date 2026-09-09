# Reuse source authority after provider discovery

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Goal

Remove repeated hosted source-authority requests without weakening disconnect or reconnect fencing.

## Success criteria

- Extended historical resource jobs share the fresh post-discovery source snapshot between local projection and admission.
- Synthetic maximum-source coverage proves one fewer source read per eligible job.
- Epoch changes before discovery, after discovery, after data fetch, and after import retain their existing fences.
- Focused tests, typecheck, complexity review, and the applicable final review pass.

## Scope

- In scope: Junction source projection and extended historical resource admission, regression proof.
- Out of scope: whole-pass authorization caching, new runtime cancellation protocols, production deployment.

## Constraints

- Keep existing source authority and SQLite observation ownership.
- No TTL, dependencies, services, persistence, or configuration.
- Keep private operational evidence out of repository artifacts.

## Risks and mitigations

1. Revocation during a provider request or import could make retained authority stale.
   Mitigation: retain fresh reads after those external boundaries; reuse only across local projection.
2. Source aliases and lifecycle epochs could diverge from provider inventory.
   Mitigation: admission uses the same authoritative source snapshot as projection, not provider inventory.
3. A read-count improvement could be mistaken for a production traffic percentage.
   Mitigation: report the synthetic per-job delta separately; production reduction requires deployment and matched observation.

## Tasks

1. [x] Trace snapshot callers, source lifecycle writers, and runtime cancellation ownership.
2. [x] Reject whole-pass caching: source revocation is not independently enforced at canonical import, and cancellation would require a new cross-service protocol.
3. [x] Reuse fresh post-discovery authority for local projection and immediate admission.
4. [x] Run focused regression tests and typecheck; review source identity and no-storage fallbacks.
5. [ ] Review diff and complexity; complete the scoped commit and applicable PR review.

## Decisions

- Prefer a smaller request reduction over an invalidation protocol spanning Web, Worker, and warm runners.
- Preserve pre-discovery, post-fetch, and post-import authority checks.
- No public changelog: internal request-count optimization with unchanged member behavior.

## Verification

- Focused Junction historical-backfill and source-admission tests.
- Device-syncd typecheck.
- Complexity diff and parent candidate review.

## Results

- Focused Vitest run: 155 tests passed across historical backfill, admission reads, timeseries source reuse, and provider identity.
- Maximum-source historical import uses four authority reads instead of five; the empty-segment retry path uses three instead of four.
- Failure injection now follows the actual provider-fetch boundary rather than an obsolete read ordinal.
- Device-syncd typecheck and diff whitespace checks passed.
- Complexity guard passed: unchanged aggregate debt, maximum function score reduced from 145 to 143. The changed projection function remains a hotspot at 47; broader provider restructuring is outside this request.
- Parent review confirmed source reads remain live across provider/import boundaries and production projection uses synchronous SQLite writes. No Web, Worker, or persisted protocol changes.
