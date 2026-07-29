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
- On a quiet rollout wake for an existing member, reuse a valid active route
  from an immutable member-owned managed automation before consulting local
  delivery defaults; do not make backfill wait for another inbound message.
- When live Linq authority moves a personal route to the current home thread,
  carry the authority-owned privacy-blinded conversation locator separately
  from the raw provider target and use both views of that same thread.
- Enforce the no-mutation boundary above editable task text for this exact
  identity: retain current conversation and vault reads, but remove hosted
  dynamic mutation tools, external network access, generated memories, and
  filesystem writes for the scheduled occurrence.

## Verification

- Focused assistant-engine scheduling, reconciliation, session continuity,
  vault-capability, skip, and lifecycle tests.
- Focused assistant-runtime managed-maintenance tests only if runtime bundle
  wiring remains changed after simplification.
- `pnpm test:diff` for every touched package and durable doc.
- `pnpm verify:acceptance`.
- Product-experience review, preliminary prompt/coverage ReviewGPT, parent
  final review, final ReviewGPT, CI, and clean merge proof.

## Evidence

- Focused Assistant Engine choice-point, cron, outbox, and
  managed-automation tests: 314 passed.
- Focused Assistant Runtime workspace-phase tests: 263 passed.
- Focused Cloudflare runner-platform tests: 138 passed.
- Focused Web egress-authority and canonical messaging-state tests: 47 passed.
- Assistant Engine, Assistant Runtime, Cloudflare, and Web typechecks: passed.
- Direct existing-member schedule probe: an old answered completion produced
  one future same-weekday occurrence, seven-day expiry, preserved continuity,
  and member ownership.
- Canonical `pnpm verify:acceptance`: passed on the simplified exact head before
  the route/session parity correction.
- Product experience review accepted one route/session parity finding. Its
  first correction incorrectly treated a raw provider chat ID as a blinded
  conversation locator; re-review caught that production-shaped mismatch. The
  replacement derives the locator in the existing Web route-authority owner
  through the canonical direct-notification route resolver and its
  member/contact identity blind, then carries it separately through the
  existing control-plane response.
- Product-experience re-review passed the final route/session parity design:
  exact-target validation and missing-identity handling fail closed, while a
  current-home fallback resumes and delivers in the same canonical direct
  conversation.
- Canonical `pnpm test:diff` passed after the final route/session correction
  across all affected packages and apps, including 181 Assistant Engine files,
  80 Assistant Runtime files, 559 Web files plus lint/dev-smoke/production
  build, and 112 Cloudflare Node/Workers files.
- Preliminary prompt/coverage ReviewGPT accepted two findings: editable
  no-mutation text could lose to ordinary developer-level save guidance, and
  the changed-target/missing-locator retry branch lacked direct proof. The
  exact identity now installs an immutable developer/system policy and hosted
  member-read permission profile while keeping the vault-readable shell; a
  tabled cron regression proves the missing locator fails before notification
  and retains retry state.
- Post-remediation focused proof: 234 Assistant Engine planning/runner/cron
  tests and 40 hosted Codex-config tests passed; Assistant Engine, Assistant
  Runtime, and Hosted Execution typechecks passed.
