# Restore device metric cards on Biomarkers

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Restore the prior icon-led card treatment for real wearable-derived readings in the `/biomarkers` page's `From your devices` section without changing the measured lab-history flow.

## Success criteria

- Device metrics with real wearable-derived readings render as responsive cards with their biomarker icon, latest value, reading count, history span, and latest date.
- The cards remain full-surface links to the existing public biomarker detail routes and have clear hover and keyboard-focus states.
- Manual entries and lab values still cannot qualify a metric for `From your devices`, and signed-out or device-empty states still omit the section.
- The existing measured lab-result groups, empty/loading/stale/error states, and header count remain behaviorally unchanged.
- Focused tests, desktop and mobile browser proof, required frontend and coverage audits, scoped verification, commit, PR, CI, and mergeability checks complete with no unresolved accepted findings.

## Scope

- In scope:
  - Restore a small reusable device-reading card derived from the deleted biomarker browse-card treatment.
  - Replace only the `From your devices` list rows with a responsive card grid.
  - Extend the existing server-provided device biomarker descriptor only with presentation metadata already present in the generated biomarker index.
  - Update focused web tests for the restored structure and states.
- Out of scope:
  - Changing wearable selection, device-only filtering, freshness policy, browser-vault data, or query ownership.
  - Changing measured lab-result grouping or its private detail routes.
  - Restoring the old public biomarker library as the primary page experience.
  - New dependencies, persisted state, APIs, schemas, or design-system tokens.

## Constraints

- The query-owned device summary remains the only source of `From your devices` eligibility and reading metadata.
- The card stays a presentation component with no data fetching or duplicate health interpretation.
- Use the current Murph paper-card, Fraunces-number, mono-label, and bespoke biomarker-icon system.
- Preserve unrelated working-tree and coordination-ledger work.

## Risks and mitigations

1. Risk: restoring the old card accidentally restores all-source or empty catalog behavior.
   Mitigation: keep `selectBrowserVaultDeviceMetricSummary` and render cards only from its non-null summaries.
2. Risk: a multi-column card becomes cramped at narrower dashboard widths.
   Mitigation: use one column by default, two at medium widths, and three only at wider content widths; verify desktop and mobile renders.
3. Risk: metadata or long units overflow a card.
   Mitigation: keep the value and unit wrap-safe and preserve responsive text sizing and focus containment.

## Tasks

1. Recreate the historical device-reading card as a focused current-pattern component.
2. Wire the existing device-only summaries into a responsive card grid and update server presentation metadata.
3. Add focused component/page coverage for card structure, links, filtering, staleness, and signed-out/empty states.
4. Capture desktop and mobile browser evidence, resolve required frontend and coverage audits, run scoped verification, and complete the PR lane.

## Decisions

- The historical deleted `BiomarkerBrowseCard` is the visual source, but the restored component is device-specific so the removed public-library behavior does not return.
- The existing query-owned device summary remains unchanged; this is a presentation-only restoration.
- No generated image or new mock is needed because the prior component and the user's current screenshot define the before/target boundary.

## Verification

- Focused biomarker device-card and page component tests during implementation.
- `pnpm test:diff` for every touched `apps/web` path.
- Authenticated fixture-safe browser proof at desktop and mobile widths when the local route can be rendered; otherwise record the exact authenticated-state gap and use direct component-render proof for populated device cards.
- Required `frontend-review`, `coverage-write`, Claude Code UI double-check, parent final review, CI, and clean mergeability proof. ReviewGPT is expected to be exempt because the meaningful diff is minor frontend presentation that does not alter workflow, state, data flow, or authority.

## Completion evidence

- Focused biomarker device-metrics test: 3 tests passed.
- Final scoped `pnpm test:diff` passed for the touched `apps/web` files: TypeScript, 5,910 tests, lint with no errors, dev smoke, and production build.
- `frontend-review`: no evidence-backed findings; it confirmed the device-only selector and existing detail routes remain intact.
- `coverage-write`: added the cross-year history-span assertion and returned with no unresolved coverage findings.
- Parent scope/final review: the change remains a device-card presentation boundary with no new state, query, dependency, or workflow owner.
- ReviewGPT exemption: the meaningful production change is minor frontend presentation only and does not change UI state, data flow, authority, or a product-critical flow.
- Rendered browser inspection was attempted through the required in-app browser and blocked by `No browser is available`; the populated page-boundary component test is the available direct proof.
- Claude Code UI double-check was attempted with Fable and the required Opus fallback; both were blocked by `OAuth session expired and could not be refreshed`. The completed Codex `frontend-review` is the available substitute, without claiming the Claude check passed.
Completed: 2026-07-20
