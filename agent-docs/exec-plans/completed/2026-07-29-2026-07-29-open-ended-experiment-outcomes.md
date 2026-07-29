# Land open-ended experiment outcomes

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Land PR #1094 with one composable experiment-outcome contract that lets Murph
  save bounded custom numeric or structured-review outcomes without catalog
  enrollment while preserving existing canonical-metric behavior.

## Success criteria

- A custom scalar can be saved, captured through the
  existing metric pipeline, reduced with its declared statistic, and persisted
  as a truthful incomplete or complete result.
- A bounded text/photo/document baseline and follow-up can close as a typed,
  review-ready evidence receipt without manufacturing a numeric delta or
  claiming an interpretation has already happened.
- Existing experiments that use `primaryBiomarkerKey` retain their current
  behavior through one legacy-facing adapter rather than a second source of
  truth.
- Canonical query, browser projection, CLI, persisted outcome validation, and
  rendered results interpret the same declared outcome consistently.
- Temporary audit-export code is deleted, generated artifacts and durable
  product docs are current, required local verification and direct scenarios
  pass, the preliminary specialist pass and final ReviewGPT gate have no
  accepted findings, CI is green, the PR is merged, and the task worktree is
  retired.

## Scope

- In scope: experiment outcome contracts, reduction, capture/query projection,
  persisted results, CLI plumbing, assistant onboarding guidance, browser
  projection and existing result rendering where needed for end-to-end parity,
  focused regression coverage, and matching durable product specs.
- Out of scope: user-authored executable formulas, a new analytics framework,
  a new evidence ledger, a global catalog entry per exercise, or unbounded
  qualitative analysis.

## Constraints

- Technical constraints: use canonical vault records and existing metric,
  capture, and experiment owners; keep reducers in the lowest existing shared
  owner; fail closed on incompatible units; add no independent legacy and new
  analysis paths.
- Product/process constraints: automatic analysis capability is progressive
  metadata, not experiment eligibility; preserve honest confidence language;
  keep the user flow conversation-first and low burden; follow exact-head
  ReviewGPT and PR completion gates.

## Risks and mitigations

1. Risk: accepting custom outcomes while calculating them with legacy mean-only
   semantics.
   Mitigation: make the declared reducer authoritative in one shared owner and
   prove canonical query, persistence, browser projection, and rendering agree.
2. Risk: structured evidence becomes detached from its saved experiment
   definition or is misclassified as a confounder.
   Mitigation: persist a self-describing typed result keyed to the saved
   outcome and reuse the existing bounded experiment evidence owner.
3. Risk: the large existing WIP diff adds parallel architecture or breaks
   legacy experiments.
   Mitigation: audit every changed entry point from first principles, delete
   temporary and duplicated code, and retain byte-compatible legacy behavior
   through one adapter.

## Tasks

1. Reconcile PR #1094 with current `main`, remove the temporary source-export
   workflow, and establish the exact current diff and failing checks.
2. Trace the outcome contract through contracts, metrics, query, vault
   usecases, CLI, assistant guidance, browser projection, UI, and durable specs.
3. Run the required local product-experience review, preliminary
   prompt/frontend/coverage ReviewGPT pass, Claude UI double-check attempt, and
   parent-owned Feynman review; verify every actionable finding against the
   real code path.
4. Implement the smallest owner-bound fixes and focused regressions.
5. Run canonical scoped verification, direct end-to-end scenarios, and parent
   final review; update the PR intent and change-shape contract.
6. Push the exact candidate, resolve the preliminary specialist pass, close
   this plan with the final scoped commit, and complete the final ReviewGPT and
   CI loop.
7. Merge the PR, verify relevant deployment status, and retire the worktree.

## Decisions

- Reuse the existing open metric and experiment evidence pipelines; canonical
  catalogs remain enrichment rather than allowlists.
- Preserve `primaryBiomarkerKey` as a legacy read input only. New behavior has
  one resolved internal outcome descriptor.
- Select the final ReviewGPT PR gate rather than a separate local deep-review
  gate; the required product-experience review remains local.
- Treat structured evidence as observed only when its anchor resolves to an
  accessible canonical record at the query boundary. A saved receipt remains
  `ready_for_review`, not a completed interpreted result.
- Direct custom measurements remain open-world. A derived capture must resolve
  to a registered metric producer or an existing deterministic metric point
  before activation.

## Verification

- Commands to run: focused package tests and typechecks over every touched
  owner; direct CLI/query/browser parity scenarios; rendered desktop/mobile
  catalog proof; `git diff --check`; `git merge-tree --write-tree HEAD
  origin/main`; exact-head preliminary and final ReviewGPT; final PR CI and
  deployment checks. Exact-head GitHub Actions owns the broad suite under the
  current verification policy.
- Expected outcomes: all checks pass on the exact pushed head, no accepted
  review findings remain, and existing canonical/legacy experiments plus custom
  scalar and structured-review cases behave consistently.
- Product-experience review: one high and two material findings were accepted.
  Remediation verifies structured evidence references before readiness,
  projects review-ready receipts distinctly from completed numeric results,
  and rejects derived sources with neither a registered producer nor existing
  metric points. The separate future capability is a persisted interpreted
  qualitative assessment; this PR now documents only the truthful
  review-ready receipt it implements.
- Preliminary specialist review: the first pass was invalidated by incomplete
  rendered evidence and also found three material product gaps plus one
  coverage gap. Remediation preserves incomplete structured-review status
  through the UI, labels both metric windows with the declared reducer,
  describes derived sources consistently in assistant and CLI guidance, and
  proves activation from an observed unregistered metric. The expanded design
  study covers ready, missing, partial, maximum, and count states on desktop
  and mobile.
- The valid rerun found two further edge cases. The incomplete-primary notice
  now remains visible when secondary metrics render underneath it, and
  structured readiness resolves anchor ids to canonical record dates so an
  omitted or incorrectly early anchor date cannot expose future evidence.
  Canonical and browser tests cover both temporal variants, and the mixed
  incomplete-primary plus secondary-metric state has desktop/mobile proof.
- Parent final review found that a measured unitless value could still compare
  with a unit-bearing value because the one-sided-window compatibility rule was
  too broad. Shared metric-window, canonical, and browser comparisons now keep
  the known unit only when one side has no value; two observed values require
  compatible units before a delta is allowed.
- CI regression review: the first exact-head platform shard exposed three
  legacy compatibility regressions. The legacy adapter again rejects unknown
  biomarker identifiers, canonical-unit filtering rejects incomparable
  anchored values, and a one-sided metric window retains the known unit.
- Claude UI double-check: attempted with the required Fable model and stopped
  after the CLI reported exhausted usage credits. Desktop and mobile catalog
  studies were inspected locally through the repository Playwright fallback.
Completed: 2026-07-29
