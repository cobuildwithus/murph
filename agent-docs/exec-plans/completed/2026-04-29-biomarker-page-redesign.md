# Biomarker page redesign — mirror experiment IA

Status: completed
Owner: Claude (riderway)
Date: 2026-04-29
Origin: gstack /office-hours design doc + /plan-eng-review (`~/.gstack/projects/cobuildwithus-murph/wojtek-main-design-20260429-191216.md`)

## Goal

Redesign `/biomarkers/[biomarkerId]` so it mirrors the rhythm of `/experiments/[experimentId]` instead of feeling like AI slop. Split heavy research content onto a `Research` tab, rebuild the experiment ranking section as image-led cards with a signal-direction primary visual, and remove technical metadata from user-facing surface.

## Scope

User-facing UI in `apps/web` only. Frontend layer reads existing `BiomarkerPageModel` plus three temporary frontend hardcoded lookups for fields the backend (rocketman-21) will add later — tracked in TODOS.md.

## Files

New:
- `apps/web/app/biomarkers/[biomarkerId]/layout.tsx` — server, resolves biomarker, holds `generateStaticParams`
- `apps/web/app/biomarkers/[biomarkerId]/biomarker-layout-client.tsx` — client, hosts `BrowserVaultProvider` + Hero + tabs + sticky observer
- `apps/web/app/biomarkers/[biomarkerId]/research/page.tsx` — Research tab content
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-header.tsx` — eyebrow + title + summary + private trend slot
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card.tsx` — moved 1:1 from old monolith
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-about.tsx` — 3-column prose
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-experiment-card.tsx` — image-left + signal-direction hero
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-overview.tsx` — Overview tab orchestrator
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-research.tsx` — Research tab orchestrator (claims + sources + commons memo)
- `apps/web/src/components/ui/section-label.tsx` — lifted from `protocol-tab.tsx`, used on both biomarker and experiment surfaces
- `apps/web/src/lib/biomarkers/biomarker-about.ts` — TEMPORARY hardcoded prose lookup
- `apps/web/src/lib/biomarkers/biomarker-experiment-signals.ts` — TEMPORARY hardcoded `(experimentId, biomarkerId) → range/window/evidence` lookup
- `apps/web/src/lib/browser-vault/trend-comparison.ts` — lifted helpers (buildTrendComparison, formatTrendDeltaSummary, formatTrendDeltaUnit, nearFlatThresholdForUnit, formatMetricValue, hasNumericMetricValue)
- `apps/web/test/browser-vault-trend-comparison.test.ts` — migrated trend math tests

Modified:
- `apps/web/app/biomarkers/[biomarkerId]/page.tsx` — renders `BiomarkerOverview`
- `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx` — uses lifted `SectionLabel` from `ui/`
- `apps/web/test/health-commons-biomarker-detail-page.test.ts` — mock target shifted from page-client to layout-client
- `TODOS.md` — added rocketman-21 follow-up for three model fields

Deleted:
- `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx` — 1205-line monolith dispersed into focused components
- `apps/web/test/health-commons-biomarker-page-client.test.ts` — assertions hit deleted UI; trend-math tests migrated to new file

## Backend asks (rocketman-21, captured in TODOS.md)

1. `BiomarkerProtocolRankingModel.signal: { range, window } | null` — kills `biomarker-experiment-signals.ts`
2. `BiomarkerPageModel.about: { whyItMatters, howItsMeasured, whatMovesIt } | null` — kills `biomarker-about.ts`
3. `BiomarkerProtocolRankingModel.image: string` — kills `resolveHealthCommonsExperimentShell` per-row call

## Verification

- `pnpm typecheck`: green
- `pnpm lint`: green (warning fixed)
- `vitest run apps/web/test/`: 1214/1214 pass (across all test files)
- Visual readback at `localhost:3000/biomarkers/resting-heart-rate` (Overview tab): hero clean, About 3-col reads, experiment cards render image-left with rank corner indicator, signal direction hero visible
- Visual readback at `localhost:3000/biomarkers/resting-heart-rate/research` (Research tab): tab routing works, claims + commons memo render
- Experiment page `localhost:3000/experiments/finnish-sauna` still renders unchanged after `SectionLabel` lift

## Notes

- Per-component unit tests for new components are deferred per the design-doc test plan. Coverage at integration level: `health-commons-biomarker-detail-page.test.ts` exercises the layout resolver and biomarker shape; `browser-vault-trend-comparison.test.ts` covers the lifted trend math.
- The new layout has its own `generateStaticParams`. The page route inherits via Next.js layout-route relationship.
- `BrowserVaultProvider` moved from page-client into layout-client so state persists across tab switches.
Updated: 2026-04-29
Completed: 2026-04-29
