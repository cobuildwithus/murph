## Goal

Lock the cleaned device-sync architecture with focused seam docs and tests so future provider additions follow the shared descriptor, provider-owned transport/preflight, importer-owned normalization, and provider-generic hosted persistence path without reintroducing drift.

## Scope

- `packages/device-syncd/README.md`
- `packages/importers/README.md`
- `ARCHITECTURE.md`
- `docs/device-provider-contribution-kit.md`
- focused `packages/device-syncd/**`, `packages/importers/**`, and `apps/web/**` seam tests

## Constraints

- Do not implement new providers.
- Do not widen generic env or config surfaces with provider-specific fields.
- Keep the patch on docs and mechanical seam guards; avoid runtime refactors owned by adjacent lanes.
- Preserve unrelated in-flight edits across the worktree.

## Verification

- `pnpm typecheck`
- truthful focused verification for touched device-syncd/importers/apps-web tests
- readback of updated docs for the provider-addition path and generic-boundary rules
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
