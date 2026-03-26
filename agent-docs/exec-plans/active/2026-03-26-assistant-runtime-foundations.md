# Assistant runtime foundations

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Add the shared assistant runtime contracts and low-level path/queue scaffolding needed for upcoming assistant automation upgrades.
- Keep the foundation outside CLI where appropriate so `packages/parsers`, `packages/inboxd`, and `packages/device-syncd` can depend on stable runtime contracts without importing CLI internals.
- Preserve current assistant behavior while making automation-state reads tolerant across the v2 to v3 schema transition.

## Success criteria

- `packages/contracts` exports assistant automation event and cursor schemas/types from a dedicated assistant-runtime module.
- `packages/runtime-state` exports lock-safe assistant event queue helpers plus expanded assistant-state path resolution for queue, dead-letter, transcript-maintenance metadata, archives, and continuation sidecars.
- CLI assistant contracts define transcript-maintenance metadata/continuation sidecars, add an event-driven cron schedule kind, and move automation state to v3 with `eventCursor`.
- Existing automation-state files written as v2 continue to load through a tolerant migration/read path.
- Focused tests cover the path additions, queue helpers, and automation-state compatibility seams.

## Scope

- In scope:
  - shared assistant runtime event/cursor contracts
  - runtime-state assistant queue append/list helper primitives
  - assistant-state path expansion under `assistant-state/`
  - CLI-owned transcript sidecar schemas
  - tolerant automation-state v2 to v3 parsing/persistence
  - narrow doc/test updates when the runtime or verification surface changes
- Out of scope:
  - hook bus or assistant event-consumer runtime logic
  - transcript compaction/maintenance implementation
  - event-driven cron execution behavior
  - auto-reply fallback classification or other higher-level business logic

## Constraints

- Do not introduce a new workspace package unless unavoidable.
- Keep shared automation contracts outside CLI and low-level runtime helpers outside CLI.
- Do not change canonical vault boundaries.
- Keep cross-package imports on public workspace entrypoints only.
- Preserve current assistant runtime behavior except for the intended schema/path scaffolding and backward-compatible automation-state migration.

## Risks and mitigations

1. Risk: new assistant runtime contracts drift from existing CLI automation fields.
   Mitigation: read the current assistant automation schema and persistence paths first, then layer v3 compatibility on top instead of replacing the current surface blindly.
2. Risk: queue helper APIs accidentally embed higher-level automation policy.
   Mitigation: keep runtime-state helpers limited to append/list/path/locking primitives and leave scheduling or consumption logic to later branches.
3. Risk: overlapping assistant-runtime work in `packages/cli` causes merge churn.
   Mitigation: keep the lane narrow, preserve adjacent edits, and confine CLI changes to contract/persistence seams already named in the ledger row.

## Tasks

1. Add shared assistant runtime event/cursor schemas and exports in `packages/contracts`.
2. Add low-level assistant event queue helpers plus assistant-state path fields in `packages/runtime-state`.
3. Extend CLI assistant contracts with transcript-maintenance/continuation sidecars, event-driven schedule kind, and automation-state v3.
4. Update assistant persistence helpers to read v2 automation state and write v3 consistently.
5. Add focused tests, update docs if needed, then run completion audits and required verification.

## Verification

- Completion workflow audit passes:
  - `pnpm review:gpt --preset simplify --dry-run`
  - `pnpm review:gpt --preset test-coverage-audit --dry-run --no-zip`
  - `pnpm review:gpt --preset task-finish-review --dry-run --no-zip`
- Focused commands:
  - `pnpm exec vitest run packages/runtime-state/test/ulid.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/setup-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/runtime-state/test/ulid.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/setup-cli.test.ts --coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck` ✅
  - `pnpm test` ✅
  - `pnpm test:coverage` ❌ reached the final repo-wide coverage Vitest phase after the package/app build path completed, then exited with a generic `ELIFECYCLE` in the current worktree. The foundations-focused coverage run passed its tests and only hit unrelated repo-level per-file coverage thresholds outside this lane's touched files.
