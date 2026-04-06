# Hard-cut assistant-engine ownership for shared vault/inbox leaves

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make `@murphai/assistant-engine` the single owner for the vault/inbox leaf modules that are still byte-identical across `assistant-engine` and `vault-inbox`, while keeping the already-diverged orchestration and type seams local to `@murphai/vault-inbox`.

## Success criteria

- `assistant-engine` exports the canonical subpaths needed for the shared leaf modules directly, without a secondary `vault-inbox-compat/*` namespace.
- Matching `vault-inbox` leaf modules become thin re-exports from direct `@murphai/assistant-engine/...` subpaths.
- Repo consumers prefer the canonical `assistant-engine` subpaths where that reduces boundary ambiguity, while `vault-inbox` keeps only the surfaces that still own divergent assembly/orchestration.
- Package docs and top-level architecture docs describe the new ownership seam accurately.
- Required verification, final review, and scoped commit flow complete.

## Scope

- In scope:
  - `packages/assistant-engine` subpath exports and package docs
  - `packages/vault-inbox` re-export cutover for identical leaf modules plus package docs
  - direct consumer-import cleanup where a canonical `assistant-engine` import is clearer than routing through `vault-inbox`
  - architecture doc updates for the owner boundary
- Out of scope:
  - redesigning the still-diverged `vault-inbox` orchestration modules
  - moving canonical write ownership out of existing vault/core boundaries
  - unrelated assistant runtime or CLI behavior changes

## Constraints

- Technical constraints:
  - Treat the supplied patch as intent only and preserve current-tree edits.
  - Keep sibling package imports on declared public subpaths only.
  - Do not introduce compatibility shims or circular package dependencies to preserve old duplicate ownership.
- Product/process constraints:
  - Preserve current public package surfaces that other workspace packages already consume unless removing them is clearly safe in the same turn.
  - Preserve unrelated dirty worktree state and comply with ledger, verification, audit, and commit requirements.

## Risks and mitigations

1. Risk: Export-map gaps could break runtime consumers even if TypeScript path aliases still pass locally.
   Mitigation: Add the real assistant-engine subpath exports explicitly and run full repo verification.
2. Risk: Cutting consumers over too aggressively could blur genuinely local `vault-inbox` ownership.
   Mitigation: Only redirect imports for byte-identical/shared leaves and leave the known divergent files local.
3. Risk: This owner-boundary cleanup changes durable architecture expectations without documentation.
   Mitigation: Update package READMEs and `ARCHITECTURE.md` in the same change.

## Tasks

1. Register the lane in the coordination ledger and keep this plan current.
2. Identify the identical assistant-engine/vault-inbox leaf modules that should have one owner.
3. Export those leaf paths directly from `assistant-engine`, then convert the matching `vault-inbox` files to thin re-exports.
4. Clean up direct consumer imports where canonical `assistant-engine` subpaths reduce ambiguity.
5. Update docs, run required verification plus a focused boundary check, complete the required final review, and land through the scoped commit flow.

## Decisions

- Prefer direct `@murphai/assistant-engine/...` subpaths over a new compatibility namespace.
- Keep `vault-inbox` public entrypoints available where other workspace packages already depend on them, but make shared leaves obvious pass-throughs instead of second owners.
- Leave the known divergent orchestration files local to `vault-inbox` until a later dedicated refactor.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - one focused direct boundary proof showing the byte-identical shared-leaf cutover is wired through real assistant-engine exports
- Expected outcomes:
  - Required repo verification passes, or any unrelated blockers are explicitly identified and defended per repo policy.
  - Direct proof confirms the canonical subpath exports resolve as intended without a compat namespace.
- Actual outcomes:
  - `pnpm typecheck` failed for unrelated existing `apps/web` hosted-member identity type errors in `scripts/local-reset-hosted-onboarding.ts` and `src/lib/hosted-onboarding/invite-service.ts`.
  - `pnpm test:coverage` failed for an unrelated existing CLI package-shape guard: `package.json must not keep a runtime dependency on @murphai/gateway-core after the hard cut.`
  - Focused checks passed:
    - `pnpm --filter @murphai/assistant-engine typecheck`
    - `pnpm --filter @murphai/vault-inbox typecheck`
    - `pnpm --filter @murphai/murph typecheck`
    - `pnpm --filter @murphai/setup-cli typecheck`
    - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts --no-coverage test/health-descriptors.test.ts test/inbox-service-boundaries.test.ts test/json-input.test.ts test/record-mutations.test.ts test/setup-cli.test.ts`
  - Direct proof passed by importing all 25 canonicalized assistant-engine subpaths plus their `vault-inbox` pass-throughs through real package resolution and confirming matching export sets plus identical runtime bindings.
Completed: 2026-04-07
