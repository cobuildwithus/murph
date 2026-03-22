# Core markdown-registry consolidation

Status: completed
Created: 2026-03-22
Updated: 2026-03-22

## Goal

- Reuse the existing markdown-registry helpers in `packages/core` so bank registry modules stop maintaining parallel read/write plumbing.

## Success criteria

- `allergies` and `conditions` use the shared registry helper path for load/select/read/upsert target/write.
- `goals` and regimen writes move to the same helper path only if the resulting diff remains mechanical and behavior-equivalent.
- Any now-unused bank-only wrappers are removed only after references are gone.
- Sort order, markdown output, audit action strings, relative paths, validation errors, and returned record shapes remain unchanged.

## Scope

- In scope:
  - `packages/core/src/bank/{allergies,conditions,goals,regimens,shared,write-audit}.ts`
  - `packages/core/src/registry/markdown.ts`
  - targeted `packages/core/test/{health-bank,core}.test.ts`
- Out of scope:
  - changing regimen group-aware lookup semantics
  - inventing new registry abstractions beyond the helpers already in the repo
  - changing bank markdown body/frontmatter structure

## Constraints

- Prefer the exact helper path already used by `family/api.ts` and `genetics/api.ts`.
- Treat regimen-specific selector behavior as local behavior to preserve unless a replacement is obviously equivalent.
- Report behavior-risky consolidation points instead of forcing them.

## Tasks

1. Rewire allergies and conditions onto the existing registry helper flow.
2. Reassess goals and regimen writes; continue only if the transformation stays mechanical.
3. Remove dead wrappers after confirming no remaining references.
4. Run targeted core verification, then completion-workflow audit passes, then the requested package checks.

## Verification

- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/core test`
- targeted checks from `packages/core/test/{health-bank,core}.test.ts` as needed during implementation

## Outcome

- Rewired allergy, condition, goal, and regimen bank flows onto the existing markdown registry helpers for load/select/read/upsert-target/write behavior.
- Deleted the now-unused bank-local registry wrappers in `bank/shared.ts` and removed the obsolete `bank/write-audit.ts` helper.
- Preserved regimen-specific group-aware lookup behavior by keeping `selectRegimenRecord` and `resolveRegimenRecord` local.
- Requested verification passed:
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/core test`
Completed: 2026-03-22
