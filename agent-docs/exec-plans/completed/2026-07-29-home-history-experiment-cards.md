# Home history experiment card polish

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make completed experiment cards in the `/home` “Your history” section feel like clear, compact research-index entries instead of cramped miniature dashboards.

## Success criteria

- The existing `HomeExperimentCard` remains the one production owner for history-card presentation.
- A member can scan the experiment identity, lead result, remaining comparable results, and private date range in a deliberate reading order.
- Favorable, unfavorable, and neutral results stay semantically and accessibly distinguishable.
- The production component is rendered with synthetic mixed-result examples on `/design?tab=components` at desktop and mobile widths.
- Focused tests, canonical diff verification, frontend design-proof checks, rendered browser proof, and required frontend completion reviews pass.

## Scope

- In scope: completed-run `history` presentation in `HomeExperimentCard`; the history grid only where needed for the new proportions; synthetic component-catalog fixtures; focused regressions.
- Out of scope: active, paused, planned, or stopped card behavior; experiment-result calculations; result ordering; sentiment derivation; `/home` page shell; experiment detail pages.

## Constraints

- Technical constraints: reuse current data and link ownership; do not add a card-within-card metric primitive; preserve full-card navigation and focus semantics; keep the component responsive without content-dependent height hacks.
- Product/process constraints: follow the warm paper system, serif-number and mono-label rules, private-by-default presentation, and the existing `DESIGN.md` contract for Home Experiment History Cards.

## Risks and mitigations

1. Risk: emphasizing one result could imply that the other measurements matter less or hide a mixed outcome.
   Mitigation: keep every comparable result visible and retain the existing result ordering; use scale only to establish a scan path.
2. Risk: a stronger desktop composition could collapse poorly on narrow screens or inside the open-sidebar content width.
   Mitigation: build the internal layout mobile-first and prove the real component on the catalog at desktop and phone widths.
3. Risk: presentation edits could accidentally alter active/stopped card behavior.
   Mitigation: branch only inside the existing `history` variant and retain focused lifecycle tests.

## Tasks

1. Inspect current production and catalog components and select the smallest reusable composition.
2. Refine the completed history-card hierarchy and responsive layout without changing its data contract.
3. Add the real production component with synthetic states to `/design?tab=components`.
4. Update focused regressions and run canonical verification.
5. Capture desktop/mobile browser evidence and complete the routed frontend review gates.
6. Commit, open the PR, verify CI and mergeability, then close this plan for handoff.

## Decisions

- Reuse and refine `HomeExperimentCard`; the existing shared `MetricCard` is intentionally not nested inside it because that would create cards within a card and duplicate the current result semantics.
- Keep every comparable metric and its semantic tone. Use the first ordered metric as the lead finding, with the remaining metrics in a compact ledger below.

## Verification

- Focused: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/home-experiment-card.test.tsx --no-coverage`.
- Canonical: `pnpm test:diff apps/web/src/components/home/home-experiment-card.tsx apps/web/app/design/components-content.tsx apps/web/test/home-experiment-card.test.tsx`.
- Design gate: `pnpm test:frontend-design-proof`.
- Direct proof: desktop and mobile `/design?tab=components` screenshots of the real history-card states.
Completed: 2026-07-29
