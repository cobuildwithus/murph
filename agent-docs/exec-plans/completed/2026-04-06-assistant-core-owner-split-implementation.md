# Implement assistant-core hard cut into focused owner packages

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove `@murphai/assistant-core` as a mixed owner package and replace it with focused owner packages and direct imports:
- `@murphai/assistant-engine`
- `@murphai/vault-inbox`
- `@murphai/operator-config`
- Preserve current runtime behavior while cleaning the package graph, deleting CLI-only glue from lower layers, and deleting `packages/assistant-core` entirely at the end.

## Success criteria

- `packages/assistant-core` is removed from the workspace.
- `packages/assistantd`, `packages/assistant-runtime`, `packages/assistant-cli`, `packages/setup-cli`, and `packages/cli` no longer import `@murphai/assistant-core`.
- The new owner packages build and publish with explicit READMEs and scoped exports.
- CLI-only transport/schema helpers are no longer owned by a lower shared package.
- The repo passes the required verification baseline, or any unrelated blocker is clearly isolated.

## Scope

- In scope:
- New packages, manifests, tsconfig/vitest/docs wiring, and import cutovers.
- Contract splitting needed to keep the new package graph acyclic.
- Moving assistant runtime code, vault/inbox app code, setup/operator config code, and deleting `assistant-core`.
- Out of scope:
- Product-behavior changes beyond narrow behavior-preserving fixes required by the refactor.
- New feature work in unrelated active lanes.

## Constraints

- Technical constraints:
- Keep the package graph one-way and acyclic.
- Keep canonical writes in `@murphai/core`.
- Do not leave a long-lived compatibility shim package behind.
- Preserve hosted, daemon, and local trust boundaries.
- Product/process constraints:
- This is an exclusive broad refactor lane.
- Preserve unrelated worktree changes if they appear.
- Update durable docs and release metadata with the code move.

## Risks and mitigations

1. Risk:
   Import churn causes temporary cycles or broken public surfaces.
   Mitigation: split contracts first where needed, move packages in phases, and keep consumer cutovers centralized.
2. Risk:
   The new packages inherit the same mixed ownership under new names.
   Mitigation: move CLI glue upward and mechanical metadata downward during the refactor rather than preserving it in a renamed package.
3. Risk:
   Active assistant-core-adjacent lanes conflict with the refactor.
   Mitigation: mark the ledger row exclusive and keep the whole implementation in one coordinated lane.

## Tasks

1. Update the coordination ledger and finalize the detailed package move plan.
2. Split the current contracts/config seams so `operator-config` does not depend on assistant runtime behavior.
3. Scaffold `packages/operator-config`, move setup/config/device-client ownership there, and cut over `packages/setup-cli`.
4. Scaffold `packages/vault-inbox`, move vault/inbox/knowledge ownership there, and cut over direct consumers.
5. Scaffold `packages/assistant-engine`, move assistant runtime ownership there, and cut over `packages/assistantd`, `packages/assistant-runtime`, `packages/assistant-cli`, and `packages/cli`.
6. Move CLI-only helpers out of the lower shared layer into CLI-owned packages.
7. Rehome mechanical health CLI metadata away from the new owner packages where appropriate.
8. Delete `packages/assistant-core`, update docs/release/verification wiring, run verification, run required audits, and commit with `scripts/finish-task`.

## Decisions

- Final owner packages are `@murphai/assistant-engine`, `@murphai/vault-inbox`, and `@murphai/operator-config`.
- `@murphai/assistant-engine` may depend on `@murphai/vault-inbox` and `@murphai/operator-config`.
- `@murphai/vault-inbox` must not depend on `@murphai/assistant-engine`.
- `@murphai/operator-config` must not depend on `@murphai/assistant-engine`.
- CLI-only parsing/argv/schema helpers move upward into CLI packages rather than staying in a lower owner package.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- direct focused package checks as needed during phased cutovers
- Expected outcomes:
- The repo has no remaining `@murphai/assistant-core` imports or package metadata references.
- New owner packages and their direct consumers build cleanly.
Completed: 2026-04-06
