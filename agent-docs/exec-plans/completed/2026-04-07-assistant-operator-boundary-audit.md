# Tighten assistant/operator-config owner seams and trim wildcard exports

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove operator-config-owned duplicate source from `assistant-engine`, tighten `assistant-runtime` imports to explicit owner subpaths, and remove package wildcard exports that are unused in the current workspace.

## Success criteria

- `assistant-engine` stops owning duplicate assistant backend, hosted-config, provider-preset, and text helper source that already lives canonically under `operator-config`.
- `assistant-runtime` imports the specific `operator-config` owner subpaths it actually needs instead of the root umbrella entrypoint where that umbrella is unnecessary.
- `assistant-engine`, `assistant-cli`, and `vault-inbox` export maps no longer expose unused wildcard namespaces.
- Focused verification proves the touched package boundaries still typecheck and the directly affected tests or guards still pass.

## Scope

- In scope:
  - `packages/assistant-engine`, `packages/operator-config`, `packages/assistant-runtime`, `packages/assistant-cli`, `packages/vault-inbox`
  - focused verification on those packages and any directly affected tests/guards
- Out of scope:
  - broader extraction of the remaining duplicated `assistant-engine` / `vault-inbox` surface
  - unrelated hosted-member, Cloudflare, or apps/web work already active in the tree

## Constraints

- Treat the supplied patch as intent only and preserve adjacent in-tree edits.
- Keep imports on declared public owner subpaths only.
- Remove wildcard exports only when repo usage shows they are unused in the current workspace.

## Risks and mitigations

1. Risk: Removing a wildcard export could silently break a consumer outside the immediate touched files.
   Mitigation: search current workspace imports first and keep the cut to demonstrably unused wildcard entries only.
2. Risk: Deleting assistant-engine duplicate files could break local imports that still expect them.
   Mitigation: rewire all current imports to `operator-config` owner subpaths before deletion and rerun focused typechecks.
3. Risk: Root `operator-config` imports in assistant-runtime may still be needed indirectly.
   Mitigation: change only the imports covered by the patch intent and read back the owner files after the rewrite.

## Tasks

1. Compare the supplied patch to the current package surfaces and confirm which changes are still valid.
2. Rewire assistant-engine and assistant-runtime imports to canonical `operator-config` owner subpaths.
3. Delete assistant-engine duplicate source files that become unreachable.
4. Remove only truly unused wildcard export entries from the touched package manifests.
5. Run focused verification, complete the required final review, and land through the scoped commit flow.

## Verification

- Commands to run:
  - focused package typechecks for the touched package set
  - focused tests or boundary guards covering the changed package exports/imports
  - repo-wide guards only if they stay green or can be defended as unrelated failures

## Progress

- Completed:
  - rewired `assistant-engine` internals and `assistant-runtime` hosted seams to concrete `@murphai/operator-config/*` owner subpaths
  - deleted the duplicate `assistant-engine` copies of assistant backend, hosted-config, provider preset, and text helper source
  - removed only the wildcard exports shown unused by current workspace imports: `assistant-engine` `./assistant-cli-tools/*`, `assistant-cli` `./commands/*`, `vault-inbox` `./commands/*`, `./inbox-app/*`, and `./knowledge/*`
  - updated durable architecture/package docs to state the operator-config ownership seam explicitly
- Verification results:
  - passed: `pnpm --filter @murphai/operator-config typecheck`
  - passed: `pnpm --filter @murphai/assistant-engine typecheck`
  - passed: `pnpm --filter @murphai/assistant-runtime typecheck`
  - passed: `pnpm --filter @murphai/assistant-cli typecheck`
  - passed: `pnpm --filter @murphai/vault-inbox typecheck`
  - passed: `pnpm typecheck`
  - passed: `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/assistant-core-boundary.test.ts`
  - passed: `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-email-route.test.ts test/hosted-runtime-context.test.ts test/hosted-assistant-bootstrap.test.ts`
  - failed for unrelated pre-existing reasons:
    - `pnpm test:coverage` stops in `packages/cli/scripts/verify-package-shape.ts` with `package.json must not keep a runtime dependency on @murphai/gateway-core after the hard cut`
    - `pnpm --filter @murphai/assistant-runtime test` still has pre-existing failures in `test/hosted-runtime-isolated.test.ts` and `test/hosted-runtime-maintenance.test.ts`; the boundary assertion updated in this task now passes in isolation
- Results:
  - `pnpm --filter @murphai/operator-config typecheck`
  - `pnpm --filter @murphai/assistant-engine typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/assistant-cli typecheck`
  - `pnpm --filter @murphai/vault-inbox typecheck`
  - `pnpm typecheck`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/assistant-core-boundary.test.ts`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-email-route.test.ts test/hosted-runtime-context.test.ts test/hosted-assistant-bootstrap.test.ts`
  - `pnpm test:coverage` still fails for the pre-existing unrelated CLI package-shape guard in `packages/cli/scripts/verify-package-shape.ts` about `@murphai/gateway-core` before package coverage begins.
Completed: 2026-04-07
