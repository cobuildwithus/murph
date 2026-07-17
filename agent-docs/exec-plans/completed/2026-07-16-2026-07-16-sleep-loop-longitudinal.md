# Longitudinal sleep support and experiment integrity

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make Murph turn sleep complaints into safe, evidence-grounded, longitudinal
  support: classify the actual problem, use existing context, persist an
  accepted plan, capture outcomes truthfully, follow up only with consent, and
  close or escalate the loop instead of leaving advice in chat.

## Success criteria

- Sleep, circadian, behavior, supplement, experiment, and care skills have
  explicit non-overlapping ownership and a tested accepted-plan handoff.
- Sleep protocols can capture and analyze every declared primary subjective
  outcome; invalid protocol outcome paths fail during generation or start.
- Assistant-facing wearable queries expose a provider-neutral sleep-pattern
  summary with explicit nap identity, absolute freshness, timing variability,
  and honest coverage/caveats.
- Proactive coaching cannot treat stage-only population comparisons as a
  user problem, and sleep insights use calibrated causal language.
- Active sleep plans remain retrievable; accepted support is bounded,
  plan-linked, delivery-aware, and cleaned up when the plan stops.
- Clinical-record and regimen incompleteness is explicit before personalized
  sleep-aid guidance.
- Health Commons Start preserves stable protocol identity and excludes
  research-only/draft chooser content from runnable surfaces.
- Focused journey tests cover the ten complaint families, safety preemption,
  outcome capture, lifecycle cleanup, and fresh-thread/current-plan retrieval.
- Required verification, specialist audits, ReviewGPT, CI, plan closure,
  scoped commit, clean-base proof, and PR creation complete with no unresolved
  accepted findings.

## Scope

- In scope: assistant skills/router/context and managed prompts; experiment
  contracts, CLI, vault usecases, query analysis, automation lifecycle;
  wearable normalization/query; Health Commons validation/content visibility;
  stable web Start metadata; clinical coverage projection; focused docs/tests.
- Out of scope: a new sleep service or state owner, full clinical-grade CBT-I
  or sleep-restriction treatment, diagnosis, prescription changes, broad FHIR
  canonicalization beyond the smallest completeness boundary, unrelated UI
  redesign, and provider-specific sleep-score reverse engineering.

## Constraints

- Technical constraints: preserve one-way package ownership, canonical-vault
  product truth, typed CLI boundaries, explicit timezone/provider caveats,
  retry/idempotency invariants, and deploy compatibility.
- Product/process constraints: one meaningful change at a time by default;
  lived function outranks stage estimates; no shame, surveillance, implicit
  proactive consent, or open-ended nagging; use the lightest useful primitive.

## Risks and mitigations

1. Risk: broad changes create overlapping state owners or an oversized sleep
   subsystem.
   Mitigation: extend existing owners and shared generic primitives only.
2. Risk: outcome aliases silently analyze the wrong signal.
   Mitigation: typed subjective metrics, exact capture routes, and build/start
   validation with end-to-end fixtures.
3. Risk: recurring support survives pause/stop or mistakes delivery failure for
   disengagement.
   Mitigation: immutable owner linkage, bounded schedules, pre-send validity
   checks, and delivery-aware repair evidence.
4. Risk: provider differences, naps, travel, or DST manufacture sleep trends.
   Mitigation: explicit session kind, valid-night coverage, local-date/timezone
   semantics, missingness, and provider-mix caveats.
5. Risk: concurrent active work overlaps system prompts or experiment support.
   Mitigation: isolated worktree, narrow commits, current-head inspection before
   edits, and ordinary conflict resolution without overwriting unrelated work.

## Tasks

1. Trace current owners and add failing focused tests for the proven gaps.
2. Implement the sleep-loop skill/router/context and proactive-safety changes.
3. Implement subjective experiment capture, metric resolution, completion,
   provenance, and Health Commons runnable-surface validation.
4. Implement normalized sleep-pattern/freshness/nap query support.
5. Implement the smallest generic bounded support-series lifecycle and
   delivery-aware behavior evidence.
6. Implement clinical-coverage and full-regimen safety checks plus executable
   care handoff guidance.
7. Add missing low-burden sleep observation/protocol content only after the
   measurement path is valid.
8. Run scoped verification, required audit passes, ReviewGPT/CI, resolve all
   accepted findings, close the plan, commit, push, and open the PR.

## Decisions

- Extend `sleep-improvement`; do not add another top-level sleep skill.
- Keep goals/regimens/experiments as canonical plan owners; automations remain
  execution records, not health-plan truth.
- Prefer one-shot review support until bounded recurrence is mechanically
  proven; use shared automation lifecycle fields rather than a sleep scheduler.

## Verification

- Commands to run: focused package tests during implementation; truthful
  `pnpm test:diff`/owner coverage across touched packages; Health Commons
  verify; hosted-web verification for Start metadata; scenario integrity;
  diff/privacy/architecture guards; required coverage and frontend audits;
  ReviewGPT plus PR CI.
- Expected outcomes: all selected checks pass, direct scenario proof covers the
  longitudinal loop, and no accepted audit finding remains unresolved.
Completed: 2026-07-16
Completed: 2026-07-16
