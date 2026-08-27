# Suppress completed same-day reminders

Status: active
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Prevent an ordinary recurring reminder from repeating its requested action
  after the same private conversation already establishes that the member
  completed that action for the current occurrence window.

## Success criteria

- A scheduled reminder skips when a timestamped user report or explicit
  assistant acknowledgment establishes that the current action is already
  complete, even when this automation has no prior confirmed output in its own
  retained history.
- A different-day completion, an unrelated message, or completion of only a
  broader plan does not silence an independently authorized reminder.
- Deterministic scheduled-runtime coverage and one focused real-Codex journey
  prove the regression with synthetic, private-free fixtures.
- Relevant assistant tests, typecheck, privacy checks, ReviewGPT, and exact-head
  CI pass.

## Scope

- In scope: ordinary direct recurring-reminder decision guidance, focused
  prompt/runtime tests, a live Codex regression, and a member-visible changelog
  entry.
- Out of scope: new reminder state, cross-automation lifecycle coupling,
  silence-only cadence behavior for clinical or safety-critical reminders,
  scheduler retry/idempotency, provider delivery, and production data mutation.

## Constraints

- Technical constraints: reuse the existing recent-conversation projection and
  ordinary scheduled-turn decision; add no persisted schema, counter, or second
  state owner.
- Product/process constraints: keep each automation independently authorized,
  but let current occurrence evidence suppress redundant delivery. Preserve
  conservative sending when the conversation is ambiguous.

## User experience

- Effort: Patch.
- Outcome: A completed current reminder occurrence stays quiet instead of
  repeating its cue.
- Reaches: Existing private recurring-reminder conversations where a member
  reports completion before the scheduled decision runs.
- Proof: The production-matched synthetic Luna journey reproduces the
  redundant send before the fix, then proves current-day skip versus prior-day
  send and current-dose skip versus earlier-dose send after the fix.
- Affected person/state: a member in a private thread with an active ordinary
  recurring reminder who reports the requested action complete before the
  reminder fires again that day.
- Visible outcome: Murph acknowledges the completion and the later occurrence
  stays quiet; the recurring reminder remains active for future days.
- Proof artifact: deterministic scheduled-turn regressions plus a focused
  real-Codex journey that exercises four opposite-decision cases without a
  provider-send effect.

### Product UX walkthrough

- Person and path: a private-chat member completes the exact requested action,
  says so in the same local occurrence window, receives the ordinary foreground
  acknowledgment, and then reaches the scheduled reminder decision.
- Evidence: the production-matched live journey persists raw timestamped
  transcript records and builds the real automation instructions. Before the
  prompt change, Luna returned `send_message` with another cadence question;
  after the change, current completion skips while otherwise identical prior
  completion sends.
- Boundaries: the skip consumes only the current occurrence. Future recurrence
  stays active; stale, ambiguous, unrelated, or broader-plan completion does
  not count. Silence-only behavior for prescribed-treatment and safety-critical
  reminders remains unchanged.
- Difference from plan: none.
- Verdict: Ready.

## Risks and mitigations

1. Risk: completion of a related plan could be mistaken for completion of the
   exact reminder action.
   Mitigation: require relevant current-occurrence conversation evidence and
   retain the independent-automation boundary.
2. Risk: vague, stale, or earlier same-day completion could silence a future
   cue.
   Mitigation: preserve receipt times in private scheduled history; ambiguous
   evidence sends, and schedules with multiple daily times require the current
   time, dose, or sequence.
3. Risk: a prompt-only fixture could miss real model interpretation.
   Mitigation: add the deterministic contract first, then run the same synthetic
   journey through the real Codex App Server before and after the fix.

## Tasks

1. Correlate production feedback, mailbox, runtime, Temporal, and provider
   delivery metadata without persisting private data.
2. Add and run a failing deterministic regression and focused real-Codex
   journey for a same-evening completion followed by a scheduled occurrence.
3. Resolve the contradictory scheduled-reminder guidance with the smallest
   prompt-owner change.
4. Run focused tests, typecheck, live verification, changelog checks, and a
   privacy-focused diff inspection.
5. Commit, open the PR, run required preliminary/final ReviewGPT and CI gates,
   then close this plan in the final scoped commit.

## Decisions

- Treat current conversation evidence that the exact requested action is
  already complete as a higher-priority occurrence skip condition; it is not a
  silence-policy decision and therefore does not require prior output from the
  same automation.
- Keep future occurrences and independent automation authority unchanged.
- Preserve existing transcript receipt time through the private scheduled
  provider projection instead of creating completion state. For a user entry,
  prefer `contentReceivedAt` and fall back to `createdAt`; assistant entries use
  their existing creation time.
- Treat a schedule with one configured local time per eligible day differently
  from a potentially multi-fire schedule. Clinical and safety-critical cues
  always require current time, dose, or sequence evidence before completion can
  suppress an occurrence.

## Verification

- Commands to run: focused assistant cron/prompt Vitest, assistant-engine
  typecheck, one uniquely named `pnpm test:assistant:live` journey, changelog
  validation, privacy/diff inspection, required ReviewGPT commands, and
  exact-head CI.
- Expected outcomes: the pre-fix live journey reproduces a `send_message`
  decision; the fixed journey returns `skip`, deterministic tests pass, no
  provider-send effect is emitted, and the future-day/ambiguous safeguards stay
  covered.

## Current evidence

- Production correlation found one normal due run for the later recurring
  occurrence. Temporal activities completed once, the provider accepted and
  delivered once, and no retry, duplicate claim, mailbox replay, or failed
  delivery explains the repeated cue.
- The later scheduled Luna turn resumed the existing direct session with the
  complete bounded conversation projection. Its history had advanced by the
  two human messages and foreground acknowledgment that established completion,
  so missing or stale conversation reconstruction is not the cause.
- An earlier scheduled delivery that evening belonged to a different canonical
  automation. The later failure was not a duplicate scheduler firing for the
  same automation; the private `/ops` diagnostic can additionally classify the
  earlier automation's purpose without placing private content in this plan.
- Before the fix, the production-matched synthetic Luna journey explicitly
  recognized that the action was complete but returned `send_message` with a
  cadence question.
- The first timestamp-aware four-case Luna run passed. A shorter prompt sample
  then exposed one stochastic current-day send, so the completion-precedence
  wording was strengthened rather than accepting a flaky regression. Two
  consecutive runs of the strengthened production-composed journey passed all
  four cases: current daily completion skipped, identical prior-day evidence
  sent, an earlier clinical dose did not suppress a later dose, and explicit
  completion of the current clinical dose skipped.
- ReviewGPT's timestamp and production-composition findings were accepted. The
  fix keeps timestamps inside the existing bounded history budget and adds no
  persisted state or lifecycle owner.
- `pnpm --dir packages/assistant-engine exec vitest run
  test/assistant-cron-schedule-store.test.ts test/codex-runtime-helpers.test.ts
  test/assistant-codex-turn-planning.test.ts test/assistant-cron-runtime.test.ts`:
  412 passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- `pnpm --dir apps/web test -- changelog-page.test.tsx`: 9 passed.
- `pnpm --dir apps/web typecheck`: passed.
- Against the immutable first-reviewed capture, the final recurring-reminder
  block is 6 `o200k_harmony` tokens and 80 UTF-8 bytes smaller. Complete
  no-history requests therefore measure 25,744 tokens / 117,769 bytes direct
  and 22,268 / 102,187 group, versus base 25,606 / 116,999 and 22,130 /
  101,417. The total initial delta is +138 tokens / +770 bytes in each route.
- Trusted timestamps are conditional on cold private scheduled history and use
  the existing count/12 KB bound; ordinary foreground and group history do not
  change. A representative retained user report plus explicit assistant
  acknowledgment adds 34 tokens / 56 bytes over the same two-message history
  without timestamp labels. No tool schema changes.
