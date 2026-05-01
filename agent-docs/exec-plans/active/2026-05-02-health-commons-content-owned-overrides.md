# Move Health Commons protocol overrides into content

Status: active
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Remove protocol-specific Health Commons content overrides from hosted-web/package TypeScript where the same truth belongs in markdown/frontmatter.
- Prefer existing content fields first; add new primitives only when they are small, semantic, and reusable across protocols/biomarkers/sources.

## Success criteria

- Protocol hero/image overrides use protocol `media` data plus a generic fallback, not route-id maps.
- Protocol/biomarker display copy uses `expectedSignalDescriptions` or another content-owned semantic field, not protocol-key TypeScript overrides.
- Source/person expert copy and route-id special cases are either moved into content or explicitly retained as generator logic with a documented reason.
- Focused tests prove generated/app projections still produce the same public behavior for migrated cases.

## Scope

- In scope:
- `apps/web/src/lib/health-commons/**`
- `packages/health-commons/src/web-artifacts.ts`
- `packages/contracts/src/health-commons.ts` only for clean reusable fields if existing fields are insufficient.
- `packages/health-commons/content/**/*.md` content edits needed to replace route-id maps.
- Focused Health Commons and hosted-web projection tests.
- Out of scope:
- Visual redesign of protocol or biomarker pages.
- Evidence/claim rewrites beyond moving existing display copy into content fields.
- Broad generated artifact commits unless verification requires tracked artifacts.

## Constraints

- Preserve unrelated active dirty work in the shared checkout.
- Do not encode UI classes, colors, or layout-specific concepts in markdown.
- Keep defaults and presentation maps in TypeScript when they are genuinely generic UI behavior.
- Do not add package dependencies.

## Tasks

1. Audit protocol image overrides and migrate to existing `media` metadata.
2. Audit biomarker display hint overrides and move copy/prominence into existing `expectedSignalDescriptions` when possible.
3. Audit expert quote/source special cases and identify which need a clean source/person field.
4. Remove migrated TypeScript maps and adjust generated/app projection code.
5. Run focused verification and required completion reviews.

## Decisions

- Existing protocol `media` is the correct primitive for hero/artwork ownership.
- Existing `expectedSignalDescriptions` is the preferred primitive for protocol-specific biomarker explanation/prominence copy.

## Verification

- `pnpm --dir packages/health-commons generate:check`
- Focused Health Commons runtime/contracts tests as touched.
- Focused hosted-web Health Commons projection/component tests.
- `pnpm typecheck`
- `pnpm --dir apps/web lint` if app code changes.
