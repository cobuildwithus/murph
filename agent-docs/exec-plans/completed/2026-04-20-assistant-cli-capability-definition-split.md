## Title

Split `packages/assistant-engine/src/assistant-cli-tools/capability-definitions.ts` by tool-family while preserving the existing exported factory names.

## Goal

Reduce the dependency and ownership sprawl in `capability-definitions.ts` by extracting shared definition-wrapper helpers into `definition-factory.ts`, then moving the requested tool-family definition groups into focused `definitions/*.ts` modules without changing the existing factory names consumed by `catalog-profiles.ts`.

## Scope

- `packages/assistant-engine/src/assistant-cli-tools/capability-definitions.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definition-factory.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/web-read.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/knowledge.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/inbox-promotion.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/vault-query.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/vault-write.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/outward-side-effects.ts`
- `packages/assistant-engine/src/assistant-cli-tools/catalog-profiles.ts` only if import wiring needs a narrow adjustment

## Constraints

- Preserve behavior, exported factory names, and current call sites for the moved tool-definition factories.
- Follow the requested safe path: move the shared `define*Tool` wrapper helpers first, then move one factory group at a time.
- Keep the refactor scoped to assistant CLI tool-definition composition; do not broaden it into unrelated assistant-engine cleanup.
- Preserve unrelated dirty-tree edits, including other in-flight `packages/assistant-engine` work.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine/src/assistant-cli-tools/capability-definitions.ts packages/assistant-engine/src/assistant-cli-tools/catalog-profiles.ts packages/assistant-engine/src/assistant-cli-tools/definition-factory.ts packages/assistant-engine/src/assistant-cli-tools/definitions`
- `pnpm --dir packages/assistant-engine test:coverage` if the diff-aware lane does not provide truthful coverage for the touched owner

## Notes

- This is a structural refactor in one package seam, not intended to change tool behavior or capability registry shape.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
