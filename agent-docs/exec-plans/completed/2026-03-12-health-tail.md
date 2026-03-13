# Health tail follow-through

Status: completed
Created: 2026-03-12
Updated: 2026-03-12

## Goal

- Close the remaining health-cutover gaps so the implemented surface matches the hybrid JSONL/Markdown plan closely enough for operators and agents: add intake noun reads, make current-profile derivation reliable, and extend export packs to include health artifacts.

## Success criteria

- `vault-cli intake show <assessmentId>` and `vault-cli intake list` exist and use the health read model.
- `profile current rebuild` invalidates stale derived state when no profile snapshots remain, and `profile list` no longer advertises a non-functional status filter.
- Export packs include health ledgers/pages for assessments, profile snapshots, health history, and the health bank registries.
- Docs, fixtures, and tests match the implemented command surface and export-pack shape.
- Completion workflow audits and required repo checks pass.

## Scope

- In scope:
- `packages/cli/src/commands/intake.ts`
- `packages/cli/src/commands/profile.ts`
- `packages/core/src/profile/storage.ts`
- `packages/query/src/health/assessments.ts`
- `packages/query/src/health/profile-snapshots.ts`
- `packages/query/src/export-pack.ts`
- matching tests, fixtures, smoke scenarios, and command-surface docs
- Out of scope:
- unrelated CLI runtime wrapper files already owned by another active ledger row
- broader health-schema redesign
- non-health export-pack redesign beyond adding the missing health slices

## Constraints

- Keep the hybrid storage model unchanged:
  - Markdown for curated current state and registries
  - JSONL for append-only assessment/profile/history ledgers
- Do not touch the active CLI runtime-fix seam files claimed in `COORDINATION_LEDGER.md`.
- Keep `packages/core` as the only write path for canonical vault state.
- Keep changes additive and deterministic; no hidden fallback behavior.

## Risks and mitigations

1. Risk: Export-pack expansion drifts from the existing manifest contract.
   Mitigation: Extend the manifest/files deterministically and add tests that assert the new file set.
2. Risk: `profile current rebuild` silently leaves stale Markdown behind.
   Mitigation: explicitly remove or invalidate `bank/profile/current.md` when no accepted snapshot exists and test the zero-snapshot case.
3. Risk: Intake noun reads duplicate generic `show`/`list` logic inconsistently.
   Mitigation: route the noun commands through the existing query layer rather than adding direct file reads in CLI code.

## Tasks

1. Reserve the health-tail scope in the coordination ledger and keep a focused execution plan.
2. Add intake noun-specific `show` and `list` commands and tighten the profile command/query surface.
3. Fix current-profile rebuild invalidation for the no-snapshot case.
4. Extend export-pack generation to include the health slices and registry pages that the cutover promised.
5. Update docs/fixtures/tests, run audit passes plus required checks, and commit the exact touched files.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm test:smoke`
- completion workflow audit passes:
  - `agent-docs/prompts/simplify.md`
  - `agent-docs/prompts/test-coverage-audit.md`
  - `agent-docs/prompts/task-finish-review.md`
Completed: 2026-03-12
