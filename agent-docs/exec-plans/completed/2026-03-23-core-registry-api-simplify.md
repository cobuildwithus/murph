# Core Registry API Simplify

## Goal

Remove the repeated family/genetics markdown-registry control flow by extracting one small shared helper while preserving current behavior, storage layout, ids, errors, and markdown/frontmatter output.

## Scope

- `packages/core/src/family/api.ts`
- `packages/core/src/genetics/api.ts`
- one new helper under `packages/core/src/registry/`
- targeted core tests only if existing coverage misses the extracted flow

## Invariants

- Keep directory paths, sort order, id prefixes/generation, slug resolution, and read/select conflict behavior unchanged.
- Keep family/genetics-specific parsing, validation, and body rendering local to each module.
- Do not change `docType`/`schemaVersion` checks, error codes/messages, or frontmatter/markdown shapes.
- Avoid `packages/core/src/registry/markdown.ts` because another active core lane is already touching it.

## Plan

1. Read the two APIs and identify the exact duplicated control-flow seam.
2. Add a thin descriptor-driven helper for load/select/upsert/list/read orchestration only.
3. Rewire `family/api.ts` and `genetics/api.ts` to use the helper while keeping local field logic obvious.
4. Run targeted tests, then required repo checks and completion audit passes.
