# Current Profile Seam Cleanup

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Remove small duplicated selector/materialization plumbing around the current-profile seam in `@murph/query` while preserving the existing three-part model: snapshot ledger authority, human-facing `bank/profile/current.md`, and tolerant fallback when the Markdown page is stale, missing, or malformed.

## Success criteria

- Current-profile fallback behavior stays unchanged for stale, malformed, missing, and orphan Markdown cases.
- Query-side code has one shared path for turning a resolved current-profile entity plus retained Markdown into the query record shape.
- Snapshot recency selector plumbing is no more duplicated than necessary across the seam.
- Focused `packages/query` tests pass, and repo-required verification is rerun with unrelated failures documented if they persist.

## Scope

- In scope:
- `packages/query/src/health/{current-profile-resolution,entity-slices,profile-snapshots,projections}.ts`
- Targeted `packages/query/test/health-tail.test.ts`
- Out of scope:
- Any change to ledger-vs-Markdown ownership, tolerant fallback semantics, or core write-path behavior
- Any cross-package CLI/core/contracts refactor

## Constraints

- Technical constraints:
- Preserve current strict vs tolerant reader behavior and `markdownByPath` retention semantics.
- Keep the cleanup narrow; prefer one or two shared helpers over a new abstraction layer.
- Product/process constraints:
- Keep the snapshot ledger + materialized current-profile Markdown + tolerant fallback model intact.

## Risks and mitigations

1. Risk: Accidentally dropping raw Markdown retention for the valid current-profile document path.
   Mitigation: Keep the helper focused on materialization only and prove it through the existing selector-alignment and stale/malformed fallback tests.
2. Risk: Over-abstracting a small seam and making the query layer harder to read.
   Mitigation: Only extract helpers that are already used in more than one place and keep names tied to current-profile behavior.

## Tasks

1. Register the query cleanup lane and inspect the live seam helpers plus tests.
2. Extract the minimal shared current-profile record materialization and snapshot-selector helpers.
3. Update `profile-snapshots.ts` and any direct test call sites to use the shared helpers.
4. Run focused query tests, then repo-required verification.
5. Run mandatory audit passes, apply any behavior-preserving follow-ups, and finish the task with the plan workflow.

## Decisions

- The seam itself stays: only selector/materialization cleanup is allowed in this task.
- Keep the shared `resolveCurrentProfileRecord(...)` helper because it removes real duplication across query reads/tests without hiding behavior.
- Do not keep a shared snapshot sort-field builder: the extra helper was a no-op abstraction, so the two local selectors now return the sort fields inline.

## Verification

- Commands to run:
- `pnpm --dir packages/query test`
- `pnpm exec vitest run packages/query/test/query.test.ts packages/query/test/health-tail.test.ts packages/query/test/health-registry-definitions.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Outcomes:
- `pnpm --dir packages/query test` now fails before reaching the query suite because the shared `packages/contracts` verify script hits a pre-existing missing export (`commandNounCapabilityByNoun`).
- `pnpm exec vitest run packages/query/test/query.test.ts packages/query/test/health-tail.test.ts packages/query/test/health-registry-definitions.test.ts --no-coverage` passed (`3` files, `62` tests) as the direct query-boundary proof for this cleanup.
- `pnpm typecheck` failed in unrelated workspace build/type errors, including missing `@murph/contracts` declarations across `packages/cli` and related downstream implicit-`any` noise.
- `pnpm test` failed in unrelated workspace build/type errors under `packages/cli` / `packages/assistant-runtime` after clearing the docs drift gate.
- `pnpm test:coverage` failed in unrelated workspace build/type errors under `packages/cli` (`AssistantSelfDeliveryTarget` import mismatch).
Completed: 2026-03-28
