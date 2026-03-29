# 2026-03-29 Entity/Document Split For Registry Entities

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

- Split registry-style health data into two explicit layers:
- plain domain entities with no path/markdown concerns
- stored markdown document envelopes that carry path/raw-markdown/body/frontmatter concerns
- Keep vault storage format unchanged while removing the mixed-shape seam from core and query.

## Success criteria

- Core registry modules no longer model goal/condition/allergy/family/genetics as flattened entity-plus-document records.
- Query registry projections no longer treat normalized entity fields and document envelope fields as one type.
- CLI/runtime consumers still receive the same effective read/write behavior after adapting to the new internal split.
- Focused core/query/CLI tests cover the new seam and pass.

## Scope

- In scope:
- Shared registry markdown type/API seams in `packages/core/src/registry/**`
- Core health registry families using those seams: goal, condition, allergy, family, genetics, and adjacent protocol/provider helpers if the shared refactor requires it
- Query health registry projection/loading seams in `packages/query/src/health/{registries,canonical-collector}.ts`
- Narrow CLI adapters that consume the affected core/query return shapes
- Out of scope:
- Vault markdown/frontmatter storage rewrites
- JSONL/event/snapshot storage models
- Broad non-health markdown registries unless a tiny shared helper extraction requires it

## Constraints

- Technical constraints:
- Preserve current on-disk markdown format and selector behavior.
- Respect overlapping active lanes in `packages/query/src/canonical-entities.ts` and other query helper files; keep this pass focused on the entity/document seam.
- Product/process constraints:
- Run required completion audits (`simplify`, `task-finish-review`) plus focused verification, then repo-wide required checks.

## Risks and mitigations

1. Risk: changing public-ish return types may ripple through CLI/query consumers.
   Mitigation: push the split through shared registry APIs first, then adapt edge serializers/tests in the same pass.
2. Risk: query current-profile/profile-snapshot work overlaps nearby files.
   Mitigation: keep this lane scoped to registry-style entities and preserve adjacent snapshot changes.

## Tasks

1. Add shared entity/document wrapper types and move core registry APIs onto them.
2. Port core registry family modules to the split types without changing storage behavior.
3. Port query registry loaders/projections to the split types and adapt canonical collection.
4. Update CLI adapters/tests, run required audits/verification, and commit with this plan.

## Decisions

- Use the registry seam as the cut point; flattening for CLI/read envelopes may remain at the edge if needed, but core/query internals should stop modeling one mixed record shape.

## Verification

- Commands to run:
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/cli typecheck`
- focused Vitest suites for touched core/query/cli health registry paths
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Focused registry/entity-document seam checks pass; repo-wide failures, if any, are documented and shown to be outside this lane.
Completed: 2026-03-29
