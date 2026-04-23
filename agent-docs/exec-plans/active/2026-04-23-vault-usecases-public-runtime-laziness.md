# Keep vault-usecases public runtime lazy until query load time

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep `@murphai/vault-usecases/runtime` importable when query wiring is missing or broken, so the public runtime surface fails through `loadQueryRuntime()` instead of eager module evaluation.

## Success criteria

- Importing `packages/vault-usecases/src/runtime.ts` no longer requires `@murphai/query/id-families` or other query-owned value helpers at module load.
- `packages/vault-usecases/src/query-runtime.ts` becomes loader-only at runtime and keeps no top-level value imports from `@murphai/query/*`.
- Internal query lookup helpers still behave identically through a dedicated query-only internal helper module.
- Focused `vault-usecases` tests cover both the lazy public runtime seam and the relocated query lookup helpers.
- Required verification and required audit passes complete, or any unrelated blocker is recorded precisely.

## Scope

- In scope:
  - `packages/vault-usecases/src/{runtime.ts,query-runtime.ts,query-id-families.ts}`
  - directly coupled internal consumers under `packages/vault-usecases/src/usecases/**`
  - directly coupled tests under `packages/vault-usecases/test/{runtime,query-runtime,query-helper-coverage}.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-vault-usecases-public-runtime-laziness.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - the separate active `vault-usecases` runtime-loader ownership lane under `src/usecases/runtime.ts`
  - broader `vault-usecases` barrel cleanup beyond the reported eager query load
  - behavior changes to query id-family classification rules

## Constraints

- Technical constraints:
  - Preserve the current dirty tree and keep this change isolated to `packages/vault-usecases`.
  - Do not route the relocated helper values back through `query-runtime.ts`; the public runtime seam must stay loader-only.
- Product/process constraints:
  - Follow the high-risk repo workflow for a runtime-entrypoint change, including `coverage-write` and `task-finish-review`.
  - Do not expose personal identifiers in plan text, diffs, tests, or commit metadata.

## Risks and mitigations

1. Risk: re-exporting the helper aliases from `query-runtime.ts` would keep the public runtime seam eager.
   Mitigation: move those helpers to a separate internal module and repoint direct consumers to that owner.
2. Risk: helper relocation could accidentally change lookup classification behavior in command/helper code.
   Mitigation: keep the helper bodies as thin aliases over `@murphai/query/id-families` and preserve focused regression coverage.

## Tasks

1. Register this distinct public-runtime-laziness lane in the coordination ledger.
2. Remove top-level query-helper value imports from `query-runtime.ts` so it stays loader-only.
3. Move query lookup helper aliases to a dedicated internal module and update direct consumers/tests.
4. Add a regression proving `runtime.ts` imports cleanly without loading query-owned helper modules.
5. Run required verification and completion audits, then land the narrow fix if the dirty shared ledger still permits a scoped commit.

## Decisions

- Keep the public `./runtime` barrel unchanged; only internal helper ownership moves.
- Prefer a dedicated internal helper module over async helper wrappers so the existing synchronous call sites remain unchanged.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/vault-usecases/src/runtime.ts packages/vault-usecases/src/query-runtime.ts packages/vault-usecases/src/query-id-families.ts packages/vault-usecases/src/usecases/shared.ts packages/vault-usecases/test/runtime.test.ts packages/vault-usecases/test/query-runtime.test.ts packages/vault-usecases/test/query-helper-coverage.test.ts`
  - `pnpm test:smoke`
- Direct proof:
  - a runtime-seam regression showing `packages/vault-usecases/src/runtime.ts` imports without touching query-owned helper modules
  - focused helper tests proving id-family classification behavior is unchanged after the move
- Actual outcomes:
  - `pnpm --dir packages/vault-usecases exec vitest run test/runtime.test.ts test/query-runtime.test.ts test/query-helper-coverage.test.ts --config vitest.config.ts --no-coverage` passed after the lazy-runtime fix and the follow-up manifest-loader regression test.
  - `pnpm test:smoke` passed.
  - `pnpm typecheck` remains red for unrelated existing `packages/vault-usecases` `@murphai/core` resolution errors in untouched files such as `src/preferences.ts`, `src/usecases/capture.ts`, and `test/preferences.test.ts`.
  - `bash scripts/workspace-verify.sh test:diff ...` remains red for unrelated existing `packages/assistantd` typecheck failures in `test/http-coverage.test.ts` and `test/http.test.ts`.
  - `pnpm --dir packages/vault-usecases test:coverage` is currently red because overlapping in-flight `vault-usecases` work outside this lane already breaks `test/public-loader-seams.test.ts` and `test/workout-coverage.test.ts`; the changed seam itself keeps direct focused proof green.
