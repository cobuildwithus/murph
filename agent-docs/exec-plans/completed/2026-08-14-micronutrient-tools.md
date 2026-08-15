# Expand connected micronutrient tools and guidance

Status: completed
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Let Murph truthfully summarize supported connected-food micronutrients for a
  day or date range, explain data completeness, and distinguish imported totals
  from provider-owned nutrient targets or adequacy judgments.

## Success criteria

- The canonical meal query returns water and supported micronutrient totals
  without treating absent nutrient fields as zero.
- Assistant-facing tools expose nutrient units, contributing-meal coverage, and
  enough capability context to avoid implying a complete source-app import.
- Murph can answer a synthetic "which nutrients are low today?" request with
  supported totals and honest limitations; it does not invent targets or
  deficiency conclusions.
- Connected-provider messaging accurately describes meal-level nutrient import
  versus provider-owned daily dashboards and targets.
- Current provider units are reconciled against official documentation and
  protected by focused importer/query tests.
- Required focused checks, exact-head CI, preliminary specialist ReviewGPT,
  final ReviewGPT, and parent review pass with no unresolved findings.

## Scope

- In scope: Junction meal normalization, canonical meal nutrition totals,
  assistant CLI/tool schemas and guidance, provider capability copy, focused
  tests, and durable compatibility documentation.
- Out of scope: diagnosing deficiency, replacing clinical nutrition advice,
  importing a provider's proprietary daily dashboard or target percentages,
  adding a new persistence owner, and expanding the existing nutrition response
  card contract.

## Constraints

- Technical constraints: keep canonical evidence in meal records; derive totals
  in the existing read owner; preserve missing-versus-zero semantics; do not
  change the five-metric response-card or hosted share contracts accidentally.
- Product/process constraints: use neutral, non-diagnostic health language;
  preserve unrelated active nutrition-card work; use ReviewGPT for an early
  architecture challenge and the required exact-head completion gates.

## Risks and mitigations

1. Risk: provider unit assumptions could create materially incorrect totals.
   Mitigation: reconcile every imported field against current official schemas
   and add explicit conversion tests at the importer boundary.
2. Risk: sparse meal nutrient data could be mistaken for complete daily intake.
   Mitigation: return per-nutrient contributing-meal coverage and state that
   missing fields are unknown, not zero.
3. Risk: numeric totals could be framed as deficiency or treatment advice.
   Mitigation: separate observation from target comparison and make unsupported
   adequacy judgments fail closed with clear user-facing language.
4. Risk: broadening the existing five-metric total type could silently affect
   nutrition cards and hosted sharing.
   Mitigation: inspect all consumers and use a separate bounded nutrient read
   so existing card and hosted-share callers remain unchanged.

## Tasks

1. Map the importer, contracts, query, CLI, assistant guidance, UI capability
   copy, and every consumer of meal totals.
2. Ask ReviewGPT to challenge the proposed ownership, units, coverage semantics,
   safety language, and compatibility boundary.
3. Implement the smallest complete query/tool/guidance/capability changes with
   focused tests and durable documentation.
4. Run focused typechecks, tests, and a synthetic assistant-facing scenario.
5. Commit and push an exact candidate head, open the PR, and run preliminary
   specialist and final ReviewGPT stages concurrently with required CI.
6. Resolve accepted findings, repeat affected proof, complete parent review,
   close this plan, and hand off the green PR.

## Decisions

- Do not add a second nutrient persistence model; connected meal records remain
  canonical and totals remain derived query output.
- Do not label a nutrient low solely from an imported total. Provider target
  parity and individualized adequacy are separate capabilities.
- Keep the existing five-metric `meal totals` contract unchanged. Add a separate
  `meal nutrients` read so the assistant only pays the larger response cost for
  vitamin, mineral, or water questions.
- Keep persisted unit names aligned with the pinned Junction meal-summary SDK
  contract. Current Junction Sense column documentation uses different converted
  units, so do not relabel historical summary values or infer a migration from
  that separate surface.
- Do not ship a general daily-reference scoring model in this change. When a
  member requests comparison, the assistant must use a current authoritative
  source, gather the applicable demographic context, and decline incompatible
  nutrient-form comparisons.
- The early ReviewGPT architecture request was accepted, but both response
  capture and same-thread export failed at the local browser boundary. The
  candidate still requires the normal exact-head preliminary and final
  ReviewGPT gates.
- The preliminary specialist pass and final round 1 both found that Junction's
  `> 0` micronutrient predicate contradicted the new recorded-zero contract.
  Preserve finite zero at that existing normalization boundary and prove null
  versus zero separately.
- The specialist pass found that aggregate coverage spans every selected stored
  meal, not one provider. Describe that denominator directly, prohibit
  provider-specific completeness claims without separate evidence, and prove
  the mixed connected/manual limitation at the real App Server boundary.
- Final round 1 found that date filtering preceded provider-revision collapse.
  Collapse first in the shared meal-query owner and then filter the surviving
  effective meal date so daily and combined ranges cannot count one corrected
  meal inconsistently.
- Final round 1 could not inspect frontend images because only the preliminary
  specialist packet carries the required rendered evidence. The specialist
  pass inspected both packaged viewports and returned no frontend finding, so
  no product remediation is required for that packet-scope gap.

## Verification

- Commands to run: focused importer/query/CLI/assistant tests and typechecks,
  provider-schema unit fixtures, exact synthetic daily aggregation proof, and
  required exact-head GitHub Actions.
- Expected outcomes: correct totals and units, explicit sparse coverage,
  unchanged five-metric consumers, truthful assistant capability language, and
  no unresolved ReviewGPT findings.

## Completion evidence

- Focused owner proof passed for contracts, query, vault use cases, CLI,
  importers, assistant skills/runtime, web connection copy, changelog, generated
  package shape, and touched owner typechecks.
- The preliminary specialist review found connected-zero loss, aggregate source
  attribution ambiguity, and a missing runtime scenario. Each finding was
  reproduced at its owner boundary and corrected without a new abstraction.
- Final ReviewGPT round 1 additionally found range filtering before revision
  collapse. The shared query selector now collapses first; focused proof covers
  old-day, corrected-day, and combined macro and nutrient reads.
- Final ReviewGPT round 2 returned `ROUND_OUTCOME: PASS` on the corrected merged
  candidate with no qualifying findings and explicitly verified all four
  corrections.
- Desktop and mobile design-catalog captures were inspected locally, inspected
  again after hosting, and reviewed by the preliminary frontend lens with no
  frontend finding.
- The complete first provider request adds five tokens and 13 UTF-8 bytes for
  individual Murph and adds zero tokens/bytes for group Murph; lazy skill bodies
  do not enter the initial request.
Completed: 2026-08-14
