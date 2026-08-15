# Expand connected micronutrient tools and guidance

Status: active
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

## Verification

- Commands to run: focused importer/query/CLI/assistant tests and typechecks,
  provider-schema unit fixtures, exact synthetic daily aggregation proof, and
  required exact-head GitHub Actions.
- Expected outcomes: correct totals and units, explicit sparse coverage,
  unchanged five-metric consumers, truthful assistant capability language, and
  no unresolved ReviewGPT findings.
