# Murph Age model-card owner boundary

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Move Murph Age local model-card artifact validation/parsing ownership into `@murphai/health-metrics`, so query code only reads files and delegates the model-card contract to the package that owns Murph Age model/result policy.

## Success criteria

- `packages/health-metrics` exports the model-card artifact schema version, artifact types, parser, and policy validator.
- `packages/query` no longer owns duplicate Zod schemas for Murph Age risk models/model-card artifacts.
- Local model-card loading behavior remains the same for valid, malformed, duplicate, product-mode, and unauthorized-feature artifacts.
- Focused health-metrics and query tests cover the owner boundary.

## Scope

- In scope: Murph Age model-card artifact constants/types/parsing/policy validation in `packages/health-metrics`, query filesystem loader wiring, focused tests.
- Out of scope: changing the scoring formula, changing model-card policy contents, adding new data sources, running new research loops, changing product authorization, or touching hosted/runtime unrelated work.

## Constraints

- Technical constraints: preserve package dependency direction; do not add a new dependency to `@murphai/health-metrics`; keep query as the filesystem/projection owner.
- Product/process constraints: no row data, source bodies, identifiers, or user-facing product claims; preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Manual parser accepts a malformed artifact that the old Zod schema rejected.
   Mitigation: Add focused parser tests for malformed schema and cross-check parser output with `validateMurphAgeRiskModel`.
2. Risk: Moving policy validation changes local research model loading behavior.
   Mitigation: Reuse existing query runtime tests and keep warning codes/messages compatible where those tests assert them.

## Tasks

1. Inspect existing query-owned artifact schema and tests. Done.
2. Add health-metrics-owned artifact contract parsing and policy validation.
3. Update query loader to call the health-metrics parser/validator and remove duplicate schemas/Zod use from the Murph Age query module.
4. Add/adjust focused tests.
5. Run package typechecks, package coverage, smoke/diff checks, required audits, and finish with a scoped commit if safe.

## Decisions

- Keep `.runtime/operations/murph-age/model-cards` path ownership in query because it is a local vault/projection filesystem concern.
- Keep the artifact parser dependency-free inside health-metrics instead of adding Zod to that package.

## Verification

- Commands to run:
  - `pnpm --dir packages/health-metrics typecheck`
  - `pnpm --dir packages/query typecheck`
  - `pnpm --dir packages/health-metrics test:coverage`
  - `pnpm --dir packages/query test:coverage`
  - `pnpm test:smoke`
- Expected outcomes: all focused checks pass; if root typecheck remains red from the known unrelated contracts/scripts drift, report it rather than attributing it to this diff.
