# Runtime Loader Ownership

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Restore package ownership for dynamic runtime loading so inbox-owned modules are resolved by inbox-facing packages instead of by `@murphai/vault-usecases`.

## Success criteria

- `@murphai/vault-usecases/runtime` only owns vault/query/importer runtime loading.
- `@murphai/inbox-services` resolves inbox-owned runtime packages itself for its default environment wiring.
- CLI wiring no longer relies on `@murphai/vault-usecases/runtime` to load inbox-owned modules.
- The setup/runtime import path that previously failed still works after removing the extra `vault-usecases` dependency backfill.

## Scope

- In scope:
- `packages/inbox-services` runtime-loader ownership and tests
- `packages/cli` inbox iMessage runtime wiring and tests
- `packages/vault-usecases` dependency surface needed to restore correct ownership
- lockfile updates required by dependency changes
- Out of scope:
- broad redesign of assistant-engine runtime loading
- changing the generic low-level `runtime-import` helper used internally by `vault-usecases`

## Constraints

- Do not change user-facing behavior beyond restoring the intended package ownership boundary.
- Preserve public entrypoints unless a removal is clearly unused and safe.
- Preserve unrelated worktree changes.
- Keep dependency declarations aligned with the package that actually executes each dynamic import.

## Risks and mitigations

1. Risk: Moving loaders can break setup/runtime flows that rely on dynamic module resolution.
   Mitigation: keep focused direct import proofs from the same call path that originally failed.
2. Risk: Test mocks may be coupled to `@murphai/vault-usecases/runtime` and hide real ownership errors.
   Mitigation: update package-local tests to mock the new owning seam directly.
3. Risk: Removing the dependency backfill could regress another call site still using `vault-usecases` for inbox-owned modules.
   Mitigation: search all `loadRuntimeModule` call sites before removing the dependencies and keep remaining ownership intentional.

## Tasks

1. Move inbox-services default inbox runtime loading onto an inbox-owned helper or local imports.
2. Move CLI default iMessage loader wiring off `@murphai/vault-usecases/runtime`.
3. Remove now-unneeded inbox runtime dependencies from `packages/vault-usecases`.
4. Update focused tests and lockfile.
5. Run focused verification and direct setup import proof.
6. Run the required final audit pass and land a scoped commit.

## Decisions

- Keep `@murphai/vault-usecases/runtime` as the public owner for vault/query/importer runtime helpers.
- Fix the ownership boundary by relocating inbox-owned dynamic imports to inbox-facing packages instead of expanding `vault-usecases` further.

## Verification

- Commands to run:
- `pnpm --filter @murphai/inbox-services typecheck`
- `pnpm --filter @murphai/inbox-services test`
- `pnpm --filter @murphai/cli typecheck`
- `pnpm --filter @murphai/cli test`
- direct Node import proof for the setup/runtime path
- `pnpm typecheck`
- Expected outcomes:
- focused package checks pass, the setup/runtime import proof passes, and any repo-wide failure is credibly unrelated and documented.
Completed: 2026-04-09
