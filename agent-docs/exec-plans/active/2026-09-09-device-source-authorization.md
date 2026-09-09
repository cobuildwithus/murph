# Remove unnecessary historical source-authority requests

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Goal and scope

Reduce hosted source-authority requests during extended historical Junction jobs while preserving health-data admission and lifecycle fencing. Changes stay in the existing provider and reliability owner. Production deployment is outside this task.

## Decisions

- Reject whole-pass authorization caching: canonical import does not independently enforce source revocation, and reliable invalidation would add a cross-service protocol.
- Use hydrated account sources to reject locally known stale epochs before inventory discovery. Inventory lists connections and capabilities, not health samples.
- After discovery, share one fresh source snapshot between local projection and admission before health-data retrieval.
- Retain fresh reads after health-data fetches and canonical imports. Do not add TTLs, services, configuration, dependencies, or persistent state.
- Keep private operational evidence outside repository artifacts. Per-job proof is not a production traffic forecast.
- No public changelog: internal request reduction preserves member behavior.

## Risks and proof

- A remote revocation newer than local hydration may permit an inventory listing; the post-discovery check still blocks health-data retrieval. Locally known superseded epochs still skip inventory.
- Projection copies the supplied source array and performs synchronous local SQLite writes in production. No external operation separates the shared source read from immediate admission.
- Alias identity, empty segments, retryable failure, old epochs, post-fetch disconnect, and post-import completion fences remain covered.
- Failure injection now follows the actual fetch boundary instead of depending on obsolete read ordinals.

## Tasks

1. [x] Trace snapshot callers, lifecycle writers, canonical import, and runtime cancellation.
2. [x] Remove the remote pre-discovery read and duplicate post-discovery read.
3. [x] Update the reliability owner and regression assertions.
4. [x] Run focused verification and parent candidate review.
5. [ ] Complete the scoped commit, PR checks, final review, and plan closure.

## Verification

- Focused Vitest: 155 passed across historical backfill, admission reads, timeseries reuse, and provider identity.
- Synthetic historical import: five source reads become three; empty-segment retry: four become two.
- Device-syncd typecheck and diff whitespace checks passed.
- Complexity guard passed: aggregate debt unchanged at 406, maximum score reduced from 145 to 143. Changed hotspots are resource execution at 143 and source projection at 47; broader provider restructuring is outside scope.
- Parent review confirmed the existing authority owner and fresh external-boundary checks remain intact. No Web, Worker, or persisted protocol changes.
