# Move Health Commons protocol overrides into content

Status: completed
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
- `expectedSignalDescriptions[].expectedDirection` reuses the existing protocol expected-direction vocabulary so protocol-specific direction can be content-owned without creating another enum.
- Subjective expected-signal cards should prefer human-readable `expected` labels when the numeric estimate would be harder to parse than the lived finding.
- The app still honors optional generated `displayValue` as a compatibility bridge for existing generated artifacts; new source content should not need it for this case.
- `preferredRouteId` and `sortRank` are generic page-level primitives for content-owned route preference and curated ordering.
- Participant-stat exclusions are generic TypeScript logic derived from existing source/appraisal metadata: primary retrospective registries marked `safety_boundary` are excluded from direct-participant totals.

## Progress

- Removed the route-id protocol image map; protocol images now come from markdown `media` plus the generic fallback.
- Removed duplicated protocol-specific biomarker display hint maps from app and generator code.
- Added content-owned expected signal directions, route preference, and sort ranks where the old TypeScript had protocol-specific behavior.
- Removed the Bryan Johnson expert quote map and the header phrase sanitizer; source/person summary and protocol copy now own that text.
- Replaced route-gated Norwegian participant count exclusion with a generic source/appraisal-driven exclusion.
- Replaced the biomarker experiment signal lookup with generated protocol tab estimates.
- Changed the pre-sleep arousal signal for the pre-sleep resonance breathing and meditation protocol to render as `Less wired`, with its estimate kept as low-confidence contextual evidence.
- Removed the remaining content-specific source-rank branch for the long-term Finnish cohort; source ordering now relies on generic evidence bucket and priority metadata.

## Verification

- `rg -n "PROTOCOL_ROUTE_IMAGES|SOURCE_PERSON_EXPERT_QUOTES|PROTOCOL_BIOMARKER_DISPLAY_HINT_OVERRIDES|SIGNAL_LOOKUP|UNWANTED_BRYAN|NORWEGIAN_4X4_ROUTE_ID|FINNISH_SAUNA_PROTOCOL_KEY|PROTOCOL_LIBRARY_ORDER|protocolLibraryOrder|routeId === \"norwegian-4x4\"|red-light-glasses-before-bed/red-light-glasses-before-bed|long-term finnish cohort" apps/web/src packages/health-commons/src packages/contracts/src --glob '!packages/health-commons/generated/**'` (no matches)
- `git diff --check`
- `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts test/health-commons.test.ts`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm --dir packages/health-commons test`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts`
- `pnpm --dir apps/web lint`
- `pnpm typecheck`
Completed: 2026-05-02
