# Align private run results with protocol results

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Make private experiment run reports use the same page rhythm and result-chart presentation as public protocol result surfaces.
- Remove the redundant finished-result headline block while preserving the canonical saved outcome data, confidence, limitations, and measured-window coverage.

## Success criteria

- Private run content aligns to the dashboard page padding instead of adding a centered `max-w-6xl` wrapper.
- Finished runs no longer render the `Saved result` summary section.
- Result charts render one per row, with adherence remaining a separate optional sidebar.
- Saved window averages use the shared experiment trend chart framing rather than a bespoke SVG branch, without inventing daily samples.
- Focused tests, `pnpm test:diff`, desktop/mobile browser proof, required frontend/coverage review, and the parent final review pass.

## Scope

- In scope: private run route layout, shared experiment result summary/chart presentation, focused result UI tests, and the matching design-system description.
- Out of scope: experiment projection semantics, canonical outcome storage, adherence calculations, public protocol content, auth, or new chart dependencies.

## Constraints

- Technical constraints: reuse existing React/Recharts components and current `TrendData`; keep measured-day coverage visible for aggregate-only outcomes.
- Product/process constraints: preserve private-by-default results and confidence limitations; prefer deletion and shared presentation over a second run-report component family.

## Risks and mitigations

1. Risk: Aggregate-only outcomes could be mistaken for daily time series.
   Mitigation: plot only the two observed window averages and retain the `Window averages` label plus measured-day coverage.
2. Risk: Shared summary changes could regress public protocol result surfaces.
   Mitigation: use focused shared-component tests and browser-check both a private run and a protocol results route.

## Tasks

1. Delete the finished summary block and private-route container override.
2. Collapse trend cards to one per row and route aggregate comparisons through the shared trend chart frame.
3. Update focused tests and the design-system rule that described the removed bespoke comparison.
4. Run routed verification, browser proof, required audits, final review, and close the plan with a scoped commit.

## Decisions

- Keep adherence as the existing optional sidebar; only the trend-card subgrid becomes a single column.
- Keep aggregate coverage disclosure and do not fabricate daily metric points.
- Keep the confidence tier beside the measured-results heading when the direct private route suppresses the finished narrative block.
- Pad aggregate-only chart domains from both relative magnitude and observed difference so small deltas are not visually exaggerated.

## Verification

- Commands run: focused Vitest for private experiment results and canonical `pnpm test:diff` for every touched production, test, and design-system path.
- Browser proof: desktop and phone-width screenshots for active and finished aggregate-only fixtures rendered through the exact shared `ResultsTab` used by protocol results; rerender the finished state after audit remediation.
- Results: 44 focused tests passed; the canonical lane passed guards, TypeScript, 6,001 tests, lint with zero errors, dev smoke, and the production build. Desktop and mobile renders confirmed the aligned margins, one-column trends, retained confidence and coverage, and proportional aggregate chart scale.

## Completion review

- `frontend-review` found missing confidence placement and an exaggerated aggregate chart scale; both were fixed and the focused rerun returned no findings.
- `coverage-write` added direct proof for shared chart use, aggregate scale/bridging, confidence placement, one-column layout, and direct-route summary suppression.
- Claude Fable could not start because usage credits were unavailable. The prescribed Opus fallback found one low-severity aggregate hover-dot mismatch; it was fixed, and the focused frontend rerun confirmed resolution.
- ReviewGPT and local deep review are not required: this is a presentation-only frontend change with no state model, data flow, authority, persistence, public API, or deploy-boundary change.
Completed: 2026-07-21
