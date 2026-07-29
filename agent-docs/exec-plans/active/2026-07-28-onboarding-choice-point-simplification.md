# Simplify onboarding choice-point execution

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Rework PR #1061 so the post-onboarding choice point is an ordinary
  member-owned managed automation that continues the current private Murph
  conversation and uses the normal vault-aware reasoning surface.

## Success criteria

- Preserve one-shot scheduling, existing-member catch-up, finite expiry,
  immutable member ownership, canonical onboarding eligibility, and
  idempotent reconciliation.
- Remove the dedicated output-only prompt/profile, projected active-goal
  titles, receipt-authorized transcript bundle, provider deadline handoff, and
  special hosted-runtime permission wiring.
- Let the existing scheduled-turn planner resolve the current direct session,
  recent conversation, normal prompt stack, skills, and vault/tool eligibility.
- Keep unclear, unshared, intentionally open, changed, and completed goals as
  explicit automation instructions without inventing progress or a problem.
- Preserve quiet skip behavior, one easy question, and no goal or plan changes
  before the member replies.
- Finish focused and canonical verification, product and ReviewGPT gates, CI,
  PR description update, and mergeability proof on the exact final head.

## Scope

- In scope: the existing PR's assistant-engine/runtime implementation and
  tests, current onboarding/architecture/security/reliability/testing docs,
  and PR completion artifacts.
- Out of scope: a new scheduler, goal-review subsystem, database state,
  onboarding schema, recurring outreach, or automatic goal/plan mutation.

## Decisions

- Use the ordinary scheduled notification path and current conversation-key
  session resolution. Do not select a trigger-specific assistant profile or
  reduced tool planner.
- Keep the stable automation identity because dynamic managed seeds still need
  immutable member-route authority.
- Keep canonical onboarding revalidation because eligibility may change after
  installation.
- Express reflection, suppression, evidence quality, and no-mutation behavior
  in the managed automation instructions, following the existing unfinished
  onboarding follow-up pattern.

## Verification

- Focused assistant-engine scheduling, reconciliation, session continuity,
  vault-capability, skip, and lifecycle tests.
- Focused assistant-runtime managed-maintenance tests only if runtime bundle
  wiring remains changed after simplification.
- `pnpm test:diff` for every touched package and durable doc.
- `pnpm verify:acceptance`.
- Product-experience review, preliminary prompt/coverage ReviewGPT, parent
  final review, final ReviewGPT, CI, and clean merge proof.
