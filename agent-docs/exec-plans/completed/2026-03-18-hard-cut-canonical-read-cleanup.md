# hard-cut canonical query and inbox cleanup

Status: completed
Created: 2026-03-18
Updated: 2026-03-18
Completed: 2026-03-18

## Goal

- Apply the incremental hard-cut cleanup so query reads reject legacy alias fields and inbox runtime state requires canonical attachment metadata instead of synthesizing it.

## Success criteria

- Query read paths only accept canonical core/experiment/journal/event/sample fields and fail fast on required-field gaps.
- Registry/query helpers stop accepting legacy alias keys such as `experiment_slug`, `document_id`, and `meal_id`.
- Inbox persistence/runtime paths require canonical attachment ids and ordinals on read, with malformed stored envelopes and legacy runtime rows rejected explicitly.
- Regression tests cover the canonical-only behavior and the removed backfill path.

## Scope

- In scope:
  - `packages/query` canonical-read tightening plus aligned test fixtures
  - CLI entity-data cleanup for experiment slug handling
  - `packages/inboxd` attachment-id enforcement plus rejection tests
- Out of scope:
  - broader `vault-cli` / `healthybob` shim migration in `packages/cli/src/setup-services.ts`
  - unrelated query/helper simplification already in progress elsewhere

## Risks and mitigations

1. Risk: the hard cut can break fixtures that still rely on legacy alias fields.
   Mitigation: update canonical fixtures and add explicit rejection tests for the sparse legacy vault and malformed inbox state.
2. Risk: the dirty worktree already contains unrelated runtime/doc changes.
   Mitigation: keep the patch narrowly scoped, preserve adjacent edits, and commit only the touched files for this task.
3. Risk: removing silent inbox repairs can surface old local runtime state.
   Mitigation: fail with specific error messages and lock the behavior in tests so the cut remains intentional.

## Tasks

1. Update query readers and helper normalization to strip legacy aliases instead of normalizing them into canonical fields.
2. Tighten inbox attachment handling to require canonical ids/ordinals everywhere on read and remove runtime backfill behavior.
3. Refresh targeted tests to use canonical fixtures and add failure coverage for rejected legacy inputs.
4. Run required verification and completion-workflow audits, then commit the scoped files.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
