# Finalize assistant-engine / vault-inbox ownership

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Finish the half-cut `@murphai/assistant-engine` / `@murphai/vault-inbox` seam by collapsing the shared vault/inbox/usecase ownership onto `assistant-engine`, so workspace consumers import one canonical owner instead of choosing between two first-class packages.

## Success criteria

- `assistant-engine` is the sole canonical workspace owner for assistant, vault, inbox, knowledge, and shared usecase surfaces.
- Workspace consumers import `assistant-engine` directly for those surfaces instead of routing through `vault-inbox`.
- The old `vault-inbox` package is removed rather than kept as a compatibility facade or second owner.
- Consumer manifests, tsconfig references, and smoke/build expectations stop treating `vault-inbox` as a first-class owner package.
- Architecture and package docs describe one coherent owner model.
- Required verification, direct boundary proof, final audit review, and scoped commit flow complete.

## Scope

- In scope:
  - `packages/assistant-engine` owner-surface cleanup
  - direct workspace consumer import cleanup where the canonical owner changes
  - package/build metadata changes needed to stop treating `vault-inbox` as an active owner and remove the obsolete package
  - architecture and package README updates for the new owner boundary
- Out of scope:
  - unrelated assistant-runtime/operator-config cleanup outside this seam
  - new package creation or broad product-behavior redesign
  - changing canonical vault write ownership outside the existing package graph

## Constraints

- Keep sibling package imports on declared public entrypoints only.
- Do not introduce new compatibility shims or circular dependencies.
- Preserve unrelated worktree edits and existing package behavior unless the owner cut requires the change.

## Risks and mitigations

1. Risk: Export-map changes can break runtime consumers even if local TS path aliases hide the gap.
   Mitigation: Remove the TS-internal aliases, update real package exports, and run focused resolution proof in addition to required verification.
2. Risk: Docs and smoke/build expectations can still describe the old half-cut seam after code moves.
   Mitigation: Update `ARCHITECTURE.md` and package READMEs in the same change.

## Tasks

1. Confirm the current duplicate/import/export graph and pick the minimal clean single-owner cut.
2. Repoint workspace consumers to `assistant-engine` for vault/inbox/usecase surfaces and export the required canonical entrypoints there.
3. Remove package metadata and build expectations that still treat `vault-inbox` as an active owner, then update architecture/package docs.
4. Run required verification and a direct package-resolution proof for the new owner seam.
5. Run the required final review audit, apply fixes, and land through `scripts/finish-task`.

## Decisions

- Target model: `assistant-engine` owns assistant, vault, inbox, knowledge, and shared usecase surfaces directly; `vault-inbox` is removed instead of left behind as a workspace compatibility package.
- Prefer direct `assistant-engine` imports over package-level indirection through `vault-inbox`.
- Keep `assistant-engine` exports explicit enough for live consumers while avoiding a second owner package.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - focused package boundary proof for the new direct `assistant-engine` owner imports/exports
- Expected outcomes:
  - Required repo verification passes, or any unrelated blockers are documented with concrete separation.
  - Direct proof shows the canonical owner entrypoints resolve through real package exports without routing through `vault-inbox`.
Completed: 2026-04-07
