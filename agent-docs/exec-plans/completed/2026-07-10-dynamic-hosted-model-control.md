# Dynamic Hosted Model Control

Status: completed
Updated: 2026-07-12

## Goal

Let Murph inspect its effective hosted model and reasoning effort, explain the
available plan-aware choices, and save a user-approved choice that takes effect
on the next hosted turn without blocking access when monthly usage is low or
exhausted.

Success criteria:

- Every eligible hosted member can choose Luna or return to the Terra default.
- Only an active paid Edge member can choose Sol; other members receive a clear
  upgrade-required result without changing their current choice.
- Murph can read the effective model, reasoning effort, available choices, and
  the point at which a saved change takes effect.
- A successful change is stored by the existing web-owned member preference
  boundary and reaches the next hosted invocation through the existing signed
  workspace read.
- Usage accounting continues to record the requested and served model emitted
  by Codex App Server, including after a model change.
- No new usage gate, wake, queue, runtime state machine, or duplicate model
  preference is introduced.

## Constraints

- Preserve web/Postgres as the single owner of hosted billing entitlement and
  member model intent.
- Preserve Codex App Server as the owner of model execution and reported usage.
- Terra remains the platform default represented by no model override.
- Do not let a model or reasoning change mutate the already-running turn; apply
  it only at the next provider-turn boundary.
- Keep model mutation explicit and user-approved; Murph may suggest a cheaper
  model but must not silently switch it because usage is low.
- Preserve existing authentication, suspension, billing, usage-ledger, runtime
  write-fence, privacy, and deploy-skew invariants.
- Preserve unrelated work in the shared checkout and active coordination lanes.

## Current State

- Hosted execution and usage accounting already recognize GPT-5.6 Luna, Terra,
  and Sol.
- Terra and low reasoning remain the fleet defaults; Postgres stores only
  nullable non-default model and reasoning preferences.
- The signed workspace read projects eligible model and reasoning overrides to
  the next hosted invocation, while the running turn keeps its starting target.
- The bounded signed assistant-configuration callback reads or updates those
  preferences and re-derives active-access and paid-Edge Sol eligibility in web.
- Assistant runtime sessions already represent model and reasoning effort, and
  Codex App Server reports token usage with requested and served model fields.
- Monthly allowance exhaustion is projected to runtime as an advisory decision:
  usage accounting and notices continue, but active-member work is not blocked.
  Inactive, suspended, expired-trial, and daily Linq anti-abuse enforcement stay
  unchanged.
- Settings keeps Luna and Terra editable for active personal members, adds Sol
  only for currently eligible paid Edge members, and preserves the saved model
  if a stale page loses Sol entitlement during a save.
- Home renders monthly exhaustion as an allowed advisory with truthful
  continuation copy and retains expired-trial conversion as a blocking state.

## Plan

1. Trace the existing hosted preference, dynamic-tool, per-turn execution-plan,
   signed callback, and usage-recording paths, including Codex App Server's
   supported model/reasoning update contract.
2. Define one plan-aware hosted assistant configuration read/write contract,
   storing only explicit non-default intent and deriving choices from current
   billing state.
3. Expose a bounded Murph tool that can inspect configuration and apply a
   user-approved model or reasoning choice for the next turn.
4. Wire the next-turn refresh through existing hosted control-plane and runtime
   boundaries, and add focused entitlement, tool, refresh, and usage-accounting
   regressions.
5. Update durable product/architecture/security/deploy docs where the ownership
   or compatibility contract changes.
6. Run the required full verification, security/privacy and coverage-write
   audits, parent final review, scoped finish-task commit, PR, ReviewGPT loop,
   and final CI/mergeability checks.

## Verification

- The recovery worktree is reconciled with `origin/main` through the merged
  PR #556 regression gates, the later homepage-positioning copy, and the
  intended-headline correction. The task does not modify the homepage hero,
  site metadata, or public homepage-copy tests.
- Before that final fast-forward, the affected owner typechecks passed for
  `packages/hosted-execution`, `packages/assistant-engine`, `apps/cloudflare`,
  and `apps/web`; rerun them after the RAM guard is cleared because the base
  moved afterward.
- Reconciled-head focused proof passed 258 tests across 13 files: hosted
  execution approval/control (36), assistant engine (6), Cloudflare transport
  and next-invocation projection (21), web configuration (21), web
  usage/admission and notice retry (115), Settings/Home UI (19), orchestration
  reconciliation (35), and the Prisma privacy/migration contract (5).
- The two directly relevant upstream homepage/settings files also pass their
  reconciled-head focused tests (16) after the intended-headline correction.
- Focused tests prove the running turn keeps its starting target while the
  signed workspace projection reaches only the next invocation.
- The approval binds the exact requested field mask and the full resolved
  target; field-level writes preserve dormant Sol intent, and a stale target
  rolls back both the preference write and approval consumption.
- The pre-guard security/privacy review found no evidence-backed
  medium-or-higher finding; exact-final-diff completion audits remain pending.
- The first `pnpm verify:acceptance` attempt completed broad typecheck and most
  repository gates before exposing two missing explicit reviews in the Prisma
  privacy/migration contract. Those assertions are now updated and their
  isolated file passes; a full acceptance rerun is pending RAM clearance.
- Pending post-reconcile owner typechecks, full acceptance, frontend review,
  coverage-write, parent final review, scoped finish-task commit/PR, exact-head
  ReviewGPT, and CI/mergeability checks.

## Deployment

- Preserve additive web/Worker/runner compatibility and document the final safe
  order after the exact contract is chosen.
- Explicitly check web/Worker skew and warm old-container behavior before
  handoff.

## Open Questions

- None.

Completed: 2026-07-12
