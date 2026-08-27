# Suppress completed same-day reminders

Status: active
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Prevent an ordinary recurring reminder from repeating its requested action
  after the same private conversation already establishes that the member
  completed that action for the current occurrence window.

## Success criteria

- A scheduled reminder skips when a later relevant human message says the
  current action is already complete, even when this automation has no prior
  confirmed output in its own retained history.
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
  ordinary scheduled-turn decision; add no schema, counter, or second state
  owner.
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
  redundant send before the fix and returns `skip` after it.
- Affected person/state: a member in a private thread with an active ordinary
  recurring reminder who reports the requested action complete before the
  reminder fires again that day.
- Visible outcome: Murph acknowledges the completion and the later occurrence
  stays quiet; the recurring reminder remains active for future days.
- Proof artifact: a deterministic scheduled-turn regression plus a focused
  real-Codex journey that ends in `skip` and produces no provider-send effect.

### Product UX walkthrough

- Person and path: a private-chat member completes the exact requested action,
  says so in the same local occurrence window, receives the ordinary foreground
  acknowledgment, and then reaches the scheduled reminder decision.
- Evidence: the production-matched live journey supplies the human completion
  and acknowledgment in recent conversation. Before the prompt change, Luna
  returned `send_message` with another cadence question; after the change, the
  same journey returned `skip`.
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
2. Risk: vague or stale completion language could silence a future cue.
   Mitigation: constrain the rule to the current occurrence window expressed by
   the saved reminder and recent conversation; ambiguous evidence sends.
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
  cadence question. The unchanged journey returns `skip` after the prompt
  precedence correction.
- `pnpm --dir packages/assistant-engine exec vitest run
  test/assistant-cron-runtime.test.ts`: 211 passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- `pnpm --dir apps/web test -- changelog-page.test.tsx`: 9 passed.
- `pnpm --dir apps/web typecheck`: passed.
- The recurring scheduled instruction fragment grows from 500 to 641
  `o200k_harmony` tokens and from 2,801 to 3,648 UTF-8 bytes. No tool schema or
  foreground-turn prompt changes.
