# ID-family centralization between query and CLI

Status: completed
Created: 2026-03-17
Updated: 2026-03-17
Completed: 2026-03-17

## Goal

- Stop the CLI from re-implementing query-owned non-health ID-family semantics so kind inference, queryability, and invalid-lookup constraints stay consistent across the read layer and the operator surface.

## Success criteria

- CLI non-health ID classification delegates to the query-owned helper set instead of local `startsWith()` ladders.
- Health-first behavior stays unchanged for health IDs such as `current` and `goal_*`.
- CLI-only `prov_*` handling stays local and unchanged.
- `meal_*`, `doc_*`, `xfm_*`, and `pack_*` remain non-queryable and keep the same invalid-lookup message text.
- The targeted CLI and query tests covering invalid lookup ids, health-tail behavior, document/meal link projection, and the stable query read model all pass.

## Scope

- In scope:
- `packages/cli/src/usecases/shared.ts`
- `packages/cli/src/usecases/vault-usecase-helpers.ts`
- `packages/cli/src/commands/query-record-command-helpers.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/query-runtime.ts`
- focused CLI tests and the stable query read-model test already named by the user
- Out of scope:
- changing query-owned ID-family semantics themselves
- broadening what ids the generic `show` command accepts
- moving provider ids into the query package

## Constraints

- Preserve exact user-visible behavior for health ids, `prov_*`, and current invalid-lookup error text.
- Do not silently change any discovered CLI/query mismatch; surface it explicitly.
- Keep overlap safe with other active CLI lanes and preserve adjacent dirty edits.

## Risks and mitigations

1. Risk: direct CLI imports from `@healthybob/query` could create packaging or build-shape friction.
   Mitigation: prefer centralizing through the existing CLI query-runtime boundary if needed.
2. Risk: there is already more than one CLI helper module duplicating the same semantics.
   Mitigation: collapse all touched link-projection and generic-show helpers in this lane onto one shared delegated path.
3. Risk: refactoring helper ownership could accidentally alter provider-only or health-only behavior.
   Mitigation: keep health-first guards and local provider overlays explicit, and verify with focused tests.

## Tasks

1. Wire the CLI shared helper layer to query-owned non-health ID-family helpers.
2. Update downstream CLI callers to consume the centralized helper path only.
3. Run targeted tests, then the required repo checks and completion-workflow audit passes.
4. Commit the scoped files and clear the ledger row.

## Decisions

- Centralize the synchronous non-health helper boundary in `packages/cli/src/query-runtime.ts` so CLI callers can share query-owned ID semantics without reintroducing local prefix ladders.
- Preserve the pre-existing CLI-only `current` link-kind behavior (`entity`) and `prov_*` overlay instead of silently switching them to query-owned semantics.

## Verification

- Commands to run:
- targeted Vitest for the named CLI/query tests
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- helper delegation preserves existing CLI behavior while eliminating duplicated non-health ID ladders
- Outcomes:
- `pnpm exec vitest run packages/cli/test/runtime.test.ts packages/cli/test/health-tail.test.ts packages/cli/test/vault-usecase-helpers.test.ts --no-coverage --maxWorkers 1` passed
- `pnpm exec vitest run packages/query/test/query.test.ts --no-coverage --maxWorkers 1` passed
- `pnpm typecheck` passed
- `pnpm test` failed in `packages/cli/test/inbox-incur-smoke.test.ts` on pre-existing inbox help assertions / built-CLI import behavior outside this lane
- `pnpm test:coverage` failed in `packages/cli/test/inbox-incur-smoke.test.ts` on the same unrelated inbox help assertions
