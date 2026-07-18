# Measured biomarker history

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Replace the Biomarkers library-first experience with a private, measured-results view where members can browse every lab biomarker in their vault by health area and open a biomarker to see its complete comparable history.

## Success criteria

- `/biomarkers` shows only biomarkers the member has measured, grouped by a deterministic health-area taxonomy with a truthful fallback for unmatched analytes.
- Selecting a measured biomarker opens a private detail route that shows its complete dated result history and a chart for comparable numeric values.
- Sparse results, qualitative values, comparator values, unit changes, reference-range changes, custom analytes, and browser-vault loading/empty/stale/error states are represented without silent omission or invented clinical interpretation.
- The browser vault carries only the structured all-history lab projection required by these views; dense wearable history remains bounded and public descriptions are not duplicated into private state.
- Required tests, browser proof, frontend review, coverage review, cross-cutting review, verification, scoped commit, push, PR, CI, and ReviewGPT gates complete with no unresolved accepted findings.

## Scope

- In scope:
  - Add an additive, backward-compatible all-history lab-result projection and typed browser query selectors.
  - Add deterministic measured-biomarker grouping and private detail projections.
  - Replace the `/biomarkers` browse grid with the measured-results UI.
  - Add `/biomarkers/results/[metricKey]` for private longitudinal history.
  - Reuse reviewed public metadata when available and provide explicit fallbacks for custom analytes.
  - Update focused query, browser-vault, web, export-contract, and size/privacy coverage as required by the implementation.
- Out of scope:
  - A separate Library page or test/panel-history page.
  - Direct browser file upload, CSV/FHIR importer changes, or claims of complete lifetime ingestion.
  - New canonical health record types, Postgres tables, services, personalized medical interpretation, scores, optimal ranges, or automated recommendations.
  - Deleting existing public biomarker detail routes that may still have direct consumers.

## Constraints

- Technical constraints:
  - Canonical `kind: "test"` events remain the sole lab-result truth.
  - Additive readers must accept old replicas with no lab rows; old readers must safely ignore new rows.
  - Raw reports, notes, raw references, and external identifiers stay out of the browser projection.
  - Result ranges remain tied to their source value/unit; only comparable normalized numeric values may share a chart series.
  - The encrypted browser replica remains within its existing byte limit.
- Product/process constraints:
  - Use neutral, source-attributed language and never turn a lab flag into a Murph diagnosis.
  - Preserve unrelated working-tree and ledger work.
  - Follow the routed worktree, audit, verification, commit, PR, CI, and ReviewGPT workflow.

## Risks and mitigations

1. Risk: Generic metric rows lose qualitative and source-fidelity details.
   Mitigation: Use a narrow typed lab projection that keeps original facts separate from comparable normalized values.
2. Risk: Unit or range changes produce a misleading trend.
   Mitigation: Split or withhold chart connections for incompatible values and keep the complete dated result list visible.
3. Risk: Additive replica fields create deploy-skew failures.
   Mitigation: Default missing lab arrays to empty, prove old/new round trips, and deploy the tolerant reader before the writer/UI activation.
4. Risk: Grouping hides custom or unmapped tests.
   Mitigation: Derive groups from curated metric metadata and always retain an explicit Other group.
5. Risk: All-history rows inflate the single encrypted replica.
   Mitigation: Keep the projection compact, retain the existing wearable cutoff, and add realistic byte-budget proof.

## Tasks

1. Finalize the smallest lab projection and health-area taxonomy against existing canonical/query owners.
2. Implement and test the additive browser-vault projection, parser, and selectors.
3. Implement and test the measured Biomarkers list and private detail route.
4. Add direct browser proof for desktop, mobile, and keyboard/table access.
5. Run required audits, verification, final review, scoped commit, PR, CI, and ReviewGPT.

## Decisions

- The user confirmed one measured-results page plus one biomarker detail page; there is no separate Library or test-history surface in this scope.
- Public biomarker detail routes remain intact for compatibility, but the member results flow uses a dedicated private metric route so custom analytes never 404.
- The UI groups biomarkers by health area and shows years along the longitudinal time axis rather than splitting the biomarker index into year buckets.

## Verification

- Focused query/browser-vault and web component tests during implementation.
- `pnpm test:diff` over every touched owner and reverse-dependent path.
- Direct signed-out browser proof at desktop, tablet, and mobile widths; populated, empty, stale, loading, error, and comparator states use component-render proof because no supported local authenticated browser session was available.
- `pnpm test:scenario-integrity` and any broader acceptance lane selected by the completion workflow.

## Completion evidence

- The additive all-history lab projection is derived from collapsed live canonical test events, accepts older replicas with no lab rows, excludes raw reports/notes/references/external identifiers, and remains inside the hosted replica byte limit. Query, runtime, Cloudflare limit, privacy/export, and compatibility regressions cover those boundaries.
- `/biomarkers` now groups only measured results by the deterministic health-area taxonomy, and `/biomarkers/results/[metricKey]` preserves complete dated rows while charting only one comparable normalized numeric series. Focused web coverage exercises qualitative, comparator, mixed-unit, tiny-value, stale, loading, error, empty, and signed-out states.
- Signed-out desktop, tablet, and mobile browser renders each had one page heading and no horizontal overflow; mobile keyboard order reached the sidebar toggle, Biomarkers link, and sign-in action. Authenticated populated rendering is covered by component tests rather than a real browser session because no supported local authenticated session was available.
- Required coverage-write and frontend-review passes ended with zero unresolved findings. An independent read-only UI review's accepted accessibility, truthfulness, and responsive findings were remediated before those final passes.
- Final verification passed: the focused biomarker suite (35 tests), ESLint on touched web files, the full owner/reverse-dependent `pnpm test:diff` lane, `apps/cloudflare` verification (1,838 tests), scenario integrity (204 scenarios), and a final scoped `pnpm test:diff apps/web` run (5,387 active tests, typecheck, production build, smoke test, and lint with no errors).
Completed: 2026-07-16
