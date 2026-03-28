# Local-state substrate and orchestration split

Status: completed
Created: 2026-03-19
Updated: 2026-03-28

## Goal

- Introduce one coherent shared local-state substrate for reusable path, lock, atomic-write, and runtime-storage helpers.
- Split the largest CLI/runtime orchestration modules into smaller facades and focused submodules without changing behavior or trust boundaries.

## Success criteria

- Shared local-state primitives live in one clear package boundary and remove meaningful duplication across CLI, core, and runtime-state consumers.
- `packages/cli/src/inbox-services.ts`, `packages/cli/src/assistant/memory.ts`, `packages/cli/src/setup-services.ts`, and `packages/cli/src/device-daemon.ts` are materially smaller and delegate to responsibility-scoped helpers.
- Assistant state remains outside the canonical vault and does not move into `.runtime/` without explicit documented justification.
- Existing result contracts, error semantics, and trust boundaries stay intact.
- Focused tests cover the new seams and repo-required verification passes are run.

## Scope

- In scope:
  - shared local-state path helpers, lock helpers, stale-lock inspection/reentrancy patterns, and atomic JSON/text write helpers
  - launcher-state/log-path helpers and shared SQLite runtime helpers where a shared abstraction is genuinely reusable
  - extracting inbox, assistant memory, setup, device-daemon, and assistant-store responsibilities into smaller modules with thin entrypoint facades
  - focused tests for extracted helpers and unchanged behavior
- Out of scope:
  - changing canonical vault storage rules
  - moving assistant-state into the canonical vault
  - collapsing assistant-state into `.runtime/` without doc-backed justification
  - feature-level behavior changes or new operator-facing contracts

## Constraints

- Preserve current behavior and result contracts.
- Prefer pure planning/transformation helpers plus thin side-effect adapters.
- Reduce duplication, but do not introduce micro-abstractions that hide control flow.
- Keep feature entrypoints easy to find and import after the split.

## Risks and mitigations

1. Risk: a shared local-state package could blur trust boundaries between rebuildable `.runtime` state and assistant-local state.
   Mitigation: share reusable path/lock/IO primitives while keeping assistant-state ownership and path roots explicit and documented.
2. Risk: broad file splitting could break import ergonomics or create circular dependencies.
   Mitigation: keep thin top-level facades in place and bias extracted modules toward pure helpers with one direction of dependency flow.
3. Risk: lock refactors could subtly change reentrancy or stale-lock behavior.
   Mitigation: preserve current contracts, port logic behind tests first, and centralize semantics before deleting duplicates.

## Tasks

1. Inspect hotspot modules and current tests to map duplicated local-state, lock, path, and write patterns.
2. Extend `@murph/runtime-state` or introduce a focused sibling package only if the current package boundary becomes awkward.
3. Extract shared helpers, then rewire inbox, assistant memory/store, setup, and device-daemon facades to use them.
4. Add or update focused tests around locks, local-state paths, IO helpers, and the refactored feature entrypoints.
5. Run required checks plus completion-workflow audit passes, then commit the exact touched files.

## Verification

- Focused:
  - `pnpm exec vitest run packages/cli/test/assistant-memory-boundaries.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/inbox-service-boundaries.test.ts packages/cli/test/device-daemon.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/inbox-cli.test.ts packages/core/test/core.test.ts --no-coverage --maxWorkers 1`
- Required repo checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Outcome

- Extended `@murph/runtime-state` into the shared local-state substrate for path resolution, atomic writes, directory-lock semantics, and reusable SQLite/runtime helpers.
- Split inbox, assistant memory/store, setup, and device-daemon orchestration into responsibility-scoped submodules while preserving the current assistant-state trust boundary outside the canonical vault and outside `.runtime/`.
- Added focused inbox and assistant-memory boundary tests and completed simplify, coverage, and final review passes without finding additional actionable regressions.
Completed: 2026-03-28
