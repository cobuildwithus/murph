# Query current-profile fallback simplification

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Extract the shared current-profile resolution rules so the collector and query-facing profile API use one definition of latest-snapshot selection, stale-current detection, and snapshot-derived fallback behavior.

## Success criteria

- `packages/query/src/health/canonical-collector.ts` and `packages/query/src/health/profile-snapshots.ts` share small pure helpers for current-profile fallback decisions.
- Strict collector behavior still throws on malformed `bank/profile/current.md`.
- Tolerant collector behavior still accumulates failures and falls back on missing or malformed current-profile markdown.
- Query-facing `readCurrentProfile` still falls back instead of throwing when `bank/profile/current.md` is missing, malformed, or stale.
- Existing current-profile derivation semantics from the latest snapshot remain unchanged.

## Scope

- In scope:
- extracting pure helper logic for selecting the latest snapshot, checking current-profile staleness against that snapshot, and deriving the fallback current-profile representation from the latest snapshot
- rewiring the duplicated async/sync/query-facing wrappers onto those helpers
- targeted regression coverage updates only if the extracted helpers expose an untested edge
- Out of scope:
- changing current-profile shapes, public query APIs, or collector failure contracts
- broader health-query architecture changes or collector redesign

## Constraints

- Technical constraints:
- preserve the strict vs tolerant behavior split exactly
- preserve fallback semantics for missing, stale, and malformed `bank/profile/current.md`
- reuse the existing fallback builder instead of inventing a new current-profile representation
- Process constraints:
- keep the coordination ledger current until the lane is finished
- run the simplify, coverage, and final review audit passes plus the required repo checks before handoff

## Risks and mitigations

1. Risk: sharing logic could accidentally make the strict path swallow malformed markdown/frontmatter.
   Mitigation: keep loader/parsing behavior in the wrappers and extract only pure latest/stale/fallback decisions.
2. Risk: query-facing fallback could drift if the shared helper assumes canonical entities only.
   Mitigation: define the shared helpers around the minimum data needed for latest snapshot selection and stale-current comparison, then reuse the existing entity fallback builder for record conversion.
3. Risk: date-order tie behavior could shift if the latest snapshot sort logic changes.
   Mitigation: preserve the current timestamp and id comparison rules exactly in the extracted helper.

## Tasks

1. Extract the shared current-profile resolution helpers into a small internal query-health module.
2. Rewire collector strict/tolerant wrappers and the profile snapshot API to use the shared helpers.
3. Add or adjust targeted regression tests only if needed.
4. Run simplify, coverage, and final review audit passes, then rerun required checks and commit the scoped files.

## Decisions

- Keep current-profile parsing and failure handling in the caller-specific wrappers so strict/tolerant behavior remains local and explicit.
- Centralize only the pure resolution rules: latest snapshot selection, staleness detection, and snapshot-derived fallback materialization.
- Build query-facing fallback records by converting the shared fallback entity rather than duplicating snapshot-to-current mapping logic.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- all required commands pass with no behavior changes in the current-profile fallback paths
Completed: 2026-03-17
