# Give Murph trusted member-local current time

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Restore the existing promise that Murph reasons and answers from the member's
  actual current local clock instead of treating the hosted process's UTC clock
  as member-local time.
- Keep the canonical vault timezone and one turn-resolved host instant as the
  only time authorities; add no state, provider call, scheduler, or conversion
  path owned by the model.

## Success criteria

- The production prompt-time resolver captures one current instant alongside
  the already-resolved canonical timezone and local date.
- Verified private hosted turns render that instant into an explicit local
  clock plus its UTC instant in dynamic turn context; unknown-timezone private
  turns remain explicitly UTC-only and never claim a member-local clock.
- Group, unverified-external, and non-hosted turns do not receive a personal
  current-local-clock claim from this context.
- Deterministic boundary tests fail without the correction and prove both the
  known-timezone and unknown-timezone prompt shapes without conflicting
  guidance.
- One focused production-derived real-Codex journey answers a synthetic current-
  time question from the supplied local clock and does not report the UTC clock
  as local time.
- Relevant focused tests and the Assistant Engine typecheck pass; exact-head PR
  CI and the required preliminary Product UX/prompt specialist review resolve
  with no accepted findings left open.

## Scope

- In scope:
  - `packages/assistant-engine` prompt-time resolution, turn planning, prompt
    composition, deterministic coverage, and one focused live journey.
  - A privacy-safe public changelog item for the member-visible correction.
- Out of scope:
  - Changing the canonical vault timezone owner, signup timezone capture,
    schedules, reminders, runtime clocks, delivery behavior, or persisted state.
  - Reconstructing or storing any private conversation from the reported
    incident.

## Constraints

- Technical constraints:
  - Resolve the date and clock from one host instant and use existing
    timezone-aware formatting.
  - Keep per-turn time in dynamic context so a warm Codex thread does not retain
    a stale clock.
  - Preserve the current UTC-only fallback when canonical timezone loading
    fails.
- Product/process constraints:
  - Product UX Patch. Affected journeys are a verified private hosted member
    with a canonical timezone and a turn whose canonical timezone is unknown.
  - Keep screenshots, transcripts, identifiers, and production rows out of
    tests, docs, changelog, commits, and PR text.
  - Use the worktree/PR lane, focused local proof, the real-Codex journey,
    preliminary Product UX/prompt review, parent final review, exact-head CI,
    scoped commit, and plan closure.

## Risks and mitigations

1. Risk: A current-time line placed in thread-stable context becomes stale.
   Mitigation: Compose it only in dynamic per-turn context from the turn's one
   resolved prompt-time snapshot.
2. Risk: A room or unknown-timezone context is mislabeled as a participant's
   personal local time.
   Mitigation: Limit the local-clock line to private hosted turns, omit it from
   room and unverified contexts, and retain an explicit UTC-only
   unknown-timezone branch.
3. Risk: The new line conflicts with existing date/timestamp guidance and the
   model chooses the server clock again.
   Mitigation: Assert the complete production prompt includes the trusted clock
   line and has no instruction that authorizes runtime-clock inference; review
   the actual focused live reply.

## Tasks

1. Finish the evidence trace through current code, runtime metadata, recent
   history, prompt ownership, and existing tests.
2. Add deterministic failing coverage for known and unknown timezone contexts,
   then implement the smallest prompt-time and prompt-composition correction.
3. Add the focused real-Codex journey and privacy-safe changelog item; run
   focused tests, typecheck, direct reply review, diff/privacy checks, and the
   Product UX walkthrough.
4. Commit and push the candidate, open a draft PR, run the preliminary Product
   UX/prompt specialist pass concurrently with draft PR CI, resolve findings,
   complete parent final review, close the plan, mark the final head Ready for
   required CI, and retire the worktree after the PR reaches a terminal merged
   or closed state.

## Decisions

- Root cause is at the existing prompt-time owner: it retains local date and
  timezone but discards the current instant, leaving Codex to convert a separate
  UTC process clock despite prompt warnings not to do so.
- Reuse the existing timezone-aware prompt instant formatter instead of adding
  another clock/conversion abstraction.
- Production aggregate logs in the reported time window show normal assistant
  pass and delivery completion with no corresponding runtime failure; this is a
  prompt-context defect, not a transport or wake failure.
- The local clock is private-hosted dynamic turn context only. It is not added
  to cached/thread-stable instructions, group rooms, unverified routes, local
  CLI turns, persisted state, or runtime configuration.

## Progress

- Added failing-first deterministic coverage for the captured instant,
  UTC/local date rollover, dynamic-only placement, group omission, and
  unknown-timezone UTC-only behavior; the final rerun passes all 217 focused
  assertions after the correction.
- The final Assistant Engine typecheck and task-diff whitespace/privacy checks
  pass.
- The focused `gpt-5.6-terra` local-subscription journey passed on an
  authenticated alternate home after an earlier final rerun stopped before any
  model action. The synthetic reply used the expected local clock, made zero
  tool or command actions, did not present UTC as local, and received a `Ready`
  UX verdict.
- Complete normalized first-request capture through the pinned Codex App Server
  measured the private direct turn at 28,903 to 28,977 `o200k_harmony` tokens
  (+74, +0.2560%) and 134,083 to 134,321 UTF-8 bytes (+238, +0.1775%). The
  group turn remained byte-for-byte identical at 24,888 tokens and 115,715
  bytes. The direct delta is entirely the new dynamic clock fragment; tool,
  schema, generated guidance, and all other selected provider-visible fields
  are unchanged.
- The privacy-safe changelog entry passes its 9 focused archive tests and Web
  typecheck; the PR architecture, deployment, and changelog body guards pass.
- The exact-head preliminary Product UX, prompt, and coverage specialist review
  returned `SPECIALIST_OUTCOME: PASS` with no findings. The frontend lens was
  correctly inapplicable to the content-only changelog entry.
- Parent final review re-read the complete patch and walked prompt-time
  resolution through attempt planning and dynamic prompt composition. It found
  no residual implementation, privacy, scope, or proof gap.

## Verification

- Commands to run:
  - Focused Assistant Engine Vitest files covering prompt time and turn prompt
    composition.
  - `pnpm --filter @murphai/assistant-engine typecheck`
  - `pnpm test:assistant:live -- --test "uses the trusted member-local current clock"`
  - Changelog fragment validation/focused Web test selected from its owner docs.
  - `git diff --check` plus targeted identifier/privacy scans of the task diff.
  - Exact-head required GitHub checks and the preliminary
    `completion-specialists` Product UX/prompt pass.
- Expected outcomes:
  - Known timezone: the prompt contains the local clock and same UTC instant;
    the synthetic reply reports the local clock and rejects the UTC-local
    interpretation.
  - Unknown timezone: the prompt gives UTC only and says member-local time is
    unknown.
  - No extra provider call, delivery, state, persisted field, or deployment
    ordering requirement is introduced.
Completed: 2026-08-30
