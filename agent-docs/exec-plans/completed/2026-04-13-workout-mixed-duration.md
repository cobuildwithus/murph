# Fail workout duration inference on mixed-activity notes

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Stop `workout add` from silently inventing a total duration for mixed-activity or duration-free notes, so manual workout capture fails closed instead of writing misleading `activity_session` records.

## Success criteria

- Freeform workout notes with one clear total duration still log successfully.
- Freeform notes that mention multiple activities and only a sub-activity duration fail with a targeted `--duration` error instead of writing a record.
- Freeform notes with no total duration no longer fall back to an invented default.
- Targeted CLI and usecase tests cover the new behavior and the touched package verification lane passes.

## Scope

- In scope:
- `packages/vault-usecases/src/usecases/workout.ts`
- Targeted workout parser and CLI tests
- Contract docs for `workout add` only if the user-visible behavior needs explicit durable wording
- Out of scope:
- Schema changes that make `activity_session.durationMinutes` optional
- Broader workout data-model changes for multi-sport sessions

## Constraints

- Technical constraints:
- Preserve the canonical `activity_session` contract, which still requires `durationMinutes`.
- Avoid broad parser rewrites; prefer one narrow fail-closed rule set on top of the current workout note flow.
- Product/process constraints:
- Prefer explicit user input over hidden heuristics for user-visible health records.

## Risks and mitigations

1. Risk: Overly broad mixed-activity detection could reject ordinary single-activity notes.
   Mitigation: Keep detection narrow and cover nearby notes in tests.

2. Risk: Removing the freeform fallback duration could break undocumented workflows.
   Mitigation: Keep the error targeted and verify the existing duration-bearing examples still pass.

## Tasks

1. Tighten freeform workout duration inference so missing or mixed-activity notes fail closed.
2. Add parser and CLI coverage for the mixed run-plus-swim case and duration-missing notes.
3. Run the truthful verification lane and required review passes, then finish the task cleanly.

## Decisions

- Keep `activity_session.durationMinutes` required for now; solve the bug by tightening inference rather than widening the schema.
- Treat freeform workout duration as valid only when the note supplies one clear total duration or the user provides `--duration`.
- Treat segmented notes such as warmup-plus-main-set descriptions as unsafe for duration inference even when the segments are the same sport.

## Verification

- Commands to run:
- `pnpm test:diff packages/vault-usecases/src/usecases/workout.ts packages/vault-usecases/test/workout-coverage.test.ts packages/cli/test/cli-expansion-workout.test.ts`
- Any narrower local repro commands needed while iterating
- `pnpm --dir packages/vault-usecases test:coverage`
- `pnpm build:test-runtime:prepared`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/cli-expansion-workout.test.ts packages/cli/test/workout-command-coverage.test.ts`
- Expected outcomes:
- Workout parser and CLI coverage stay green, including the new fail-closed cases.
- Actual outcomes:
- `pnpm --dir packages/vault-usecases test:coverage` passed.
- `pnpm build:test-runtime:prepared` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/cli-expansion-workout.test.ts packages/cli/test/workout-command-coverage.test.ts` passed.
- `pnpm test:diff ...` failed for an unrelated reverse-dependent `packages/assistant-engine` test in the active nutrition lane.
- `pnpm --dir packages/cli verify:coverage` failed for an unrelated package-shape freshness error because `config.schema.json` is already out of sync elsewhere in the dirty branch.
- Direct CLI proof passed: mixed and segmented notes now return `invalid_option`, and the mixed note succeeds when `--duration 70` is supplied.
Completed: 2026-04-13
