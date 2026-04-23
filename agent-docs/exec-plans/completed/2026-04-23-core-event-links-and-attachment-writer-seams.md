# Standardize core event links and attachment-backed writer seams

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Standardize `packages/core` event-spine and history internals on canonical `links` only, and deduplicate the four specialized attachment-backed event writers so carry-forward and revision behavior live in one shared helper instead of four near-copies.

## Success criteria

- `buildEventSpineEnvelope` and the health-history internals stop threading `relatedIds` through internal types/helper outputs while payload-ingestion compatibility still converts inbound `relatedIds` into canonical `links`.
- Generic event payload writes that still submit `relatedIds` persist canonical `links` exactly as before.
- `addActivitySession`, `addBodyMeasurement`, `addCapture`, and `addMeasurement` share one attachment-backed revision/write helper for lifecycle lookup, attachment staging, projection, ledger append, and audit emission.
- Existing rewrite/carry-forward behavior remains intact for all four specialized writers, including the active evidence-retention work already present in the dirty tree.
- Focused `packages/core` coverage proves the links-only compatibility seam and the shared attachment-backed writer behavior.
- Required verification, completion audits, and a scoped commit complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
- `packages/core/src/{event-links.ts,history/event-spine.ts,history/types.ts,history/api.ts,domains/events.ts}`
- directly coupled `packages/core/test/**` coverage for event-link canonicalization, history compatibility, and specialized attachment-backed writer behavior
- `agent-docs/exec-plans/active/{2026-04-23-core-event-links-and-attachment-writer-seams.md,COORDINATION_LEDGER.md}`
- Out of scope:
- changing persisted event storage shape beyond already-canonical `links`
- removing `relatedIds` from unrelated non-event domains such as assessments or higher-level usecase/query view models
- widening the active event-evidence retention work into a broader raw-owner or event-upsert redesign

## Constraints

- Technical constraints:
- Preserve persisted event/history records as canonical `links`; this task is an internal seam cleanup, not a schema change.
- Keep `relatedIds` compatibility only at ingestion boundaries that still accept untyped payloads or legacy caller shapes.
- Do not overwrite or unravel the existing dirty-tree evidence-retention edits in `packages/core/src/domains/events.ts`; refactor around them additively.
- Product/process constraints:
- This is `packages/core` runtime code, so keep the diff narrow, verify with coverage-bearing `packages/core` commands rather than broad dirty-branch fanout where possible, and preserve unrelated worktree edits.

## Risks and mitigations

1. Risk: Removing `relatedIds` from the wrong boundary could break legacy payload ingestion or history callers that still rely on it.
   Mitigation: Keep a thin compatibility adapter at ingestion and add focused tests that still pass `relatedIds` through payload-oriented surfaces.

2. Risk: The writer dedup could regress one of the four specialized attachment-backed flows because the current branch already contains in-flight carry-forward edits.
   Mitigation: Extract the shared helper around the current branch behavior instead of re-deriving semantics, and cover all four rewrite paths through focused tests.

3. Risk: Shared-file overlap in `domains/events.ts` or shared tests could make a scoped commit accidentally absorb unrelated work.
   Mitigation: Keep edits localized, inspect staged diffs carefully, and use index-scoped staging or a manual scoped commit path if `scripts/finish-task` would absorb unrelated churn.

## Tasks

1. Register the lane in the coordination ledger and keep this plan updated as implementation shape and blockers change.
2. Replace internal event-spine/history relation plumbing with canonical links only, leaving `relatedIds` compatibility at ingestion seams only.
3. Extract one shared attachment-backed event revision/write helper and route the four specialized writers through it.
4. Add focused regression coverage for legacy `relatedIds` ingestion plus the shared attachment-backed rewrite behavior.
5. Run required verification, required audit passes, rerun affected checks after fixes, and land a scoped commit.

## Decisions

- Preserve legacy `relatedIds` compatibility only where callers hand in raw payload-like inputs; internal event-spine/history helpers should reason about canonical `links` only.
- Preserve legacy `relatedIds` compatibility on the exported history append/read boundary as well, because it is still a public ingestion surface even though the internal spine now stores/normalizes canonical `links` only.
- Refactor the specialized attachment-backed writers around the already-dirty carry-forward behavior instead of trying to redesign the broader event-upsert/storage model in this task.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/core test:coverage`
- `pnpm test:smoke`
- focused direct-proof/focused Vitest runs for the new links-compatibility and attachment-backed rewrite coverage while iterating
- Expected outcomes:
- `packages/core` coverage proves the refactor without changing persisted canonical event/history behavior.
- Generic event payload ingestion still accepts `relatedIds` but persists only canonical `links`.
- The four specialized attachment-backed writers share one helper while preserving current rewrite/carry-forward behavior.
- Actual outcomes:
- `pnpm --dir packages/core exec tsc -p tsconfig.typecheck.json --pretty false` passed after the final history compatibility fix.
- `pnpm --dir packages/core test:coverage` passed after the final history compatibility fix.
- `pnpm test:smoke` passed after the final history compatibility fix.
- `pnpm typecheck` still fails for a pre-existing workspace issue in `packages/vault-usecases` resolving `@murphai/core`, while `packages/core typecheck` passes inside the workspace verifier.
- Required `task-finish-review` ran, found a real history compatibility regression, and the follow-up fix plus focused regression tests landed locally.
- Required `coverage-write` could not complete because the spawned worker hit the local Codex usage limit before it could finish; no fallback audit path was used.
Completed: 2026-04-23
