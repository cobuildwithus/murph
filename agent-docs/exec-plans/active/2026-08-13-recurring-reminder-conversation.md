# Simplify recurring reminder conversation behavior

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make ordinary recurring reminders inspect the existing conversation before
  interrupting again: send normally until a delivered reminder is unanswered,
  ask once whether to keep, change, or pause the interruption, then stay quiet
  until relevant human input changes the context.

## Success criteria

- The resident scheduled-turn contract owns the behavior for private and group
  conversations without new persisted state or a reminder-specific history.
- A focused occurrence-sequence regression proves send, one cadence question,
  then skip after continued silence.
- Medication, clinician-directed, clinical, and safety-critical reminders remain
  outside the quiet-after-silence policy and continue until explicitly changed
  or paused or an existing authoritative skip condition applies.
- Dense-cadence setup policy and Linq-only unanswered-reminder policy are
  deleted, while reminder/check-in/review authorization boundaries remain.
- Relevant package tests and TypeScript checks pass; the exact pushed PR head
  passes the required ReviewGPT stages and CI.

## Scope

- In scope: scheduled reminder execution guidance, setup prompt cleanup,
  follow-through skill simplification, Linq posture cleanup, focused tests, and
  current owner documentation when required.
- Out of scope: schema changes, new lifecycle state, duplicate-automation
  production investigation, scheduler delivery/idempotency state, and changing
  the semantics of explicitly authorized check-ins or reviews.

## Constraints

- Technical constraints: reuse the ordinary conversation session and committed
  history; preserve provider-neutral execution, existing delivery state, and
  the canonical automation owner.
- Product/process constraints: group questions are room-scoped and do not blame
  individuals; silence does not imply non-completion; repeated copy may remain
  concise when context is unchanged; default to net deletion.

## Risks and mitigations

1. Risk: broad prompt wording could silently widen a reminder into an
   accountability check.
   Mitigation: define the sole exception as cadence administration and retain
   explicit prohibitions on completion inference and participant blame.
2. Risk: a setup-only regression could miss real scheduled-turn behavior.
   Mitigation: exercise consecutive occurrences against the same conversation
   through the existing cron runtime harness.
3. Risk: channel posture could continue to fork product semantics.
   Mitigation: remove reminder behavior from Linq recovery posture and keep
   route-health guidance only.
4. Risk: the generic policy could silence a safety-critical cue without explicit
   user intent.
   Mitigation: retain an explicit resident and setup-time safety exclusion and
   exercise three unanswered prescribed-treatment occurrences in the cron
   runtime harness.

## Tasks

1. Trace current scheduled-turn history, delivery evidence, reminder scope, and
   existing dense-reminder setup policy.
2. Add a failing focused occurrence-sequence regression.
3. Implement the smallest execution guidance and delete overlapping setup,
   skill, and channel-posture policy.
4. Run focused tests and TypeScript verification; inspect the privacy-redacted
   final diff.
5. Commit, push, open the PR, run preliminary and final ReviewGPT gates with CI,
   and land every accepted patch or correction before final handoff.

## Decisions

- Use the current conversation as the only evidence source; add no engagement
  state, counter, table, scheduler phase, or reminder-specific session.
- Keep `supportKind`, automation lifecycle status, delivery/outbox state, and
  optional generic `activeUntil` because they own distinct authorization and
  reliability concerns.

## Verification

- Commands to run: focused assistant-engine Vitest files, the assistant-engine
  TypeScript check selected by repository scripts, privacy/diff inspection,
  exact-head GitHub Actions, and required ReviewGPT commands.
- Expected outcomes: focused behavior and prompt regressions pass, typecheck is
  clean, the patch is net-deleting outside focused proof/docs, ReviewGPT has no
  accepted unresolved findings, and required CI is green on the final head.
