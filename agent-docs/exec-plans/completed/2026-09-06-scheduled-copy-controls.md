# Keep automation controls out of routine notification copy

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome

Routine notifications deliver their requested content without repeating generic
change or pause offers. Existing saved control notes remain operational context.
Explicitly requested copy, concrete stop conditions, and engine-authorized
cadence questions retain their existing behavior.

## Architecture

Use the existing system-prompt owner for scheduled execution and automation
authoring, and the existing reminder-conversation owner for explicit silence
conditions. No new state, parsing, post-generation filtering, migration, provider
call, or abstraction is needed. Canonical automation records remain unchanged.
The evidence is a synthetic control-note comparison using production prompt
composition on Terra and Luna. The control note can leak into notification copy.

## Product UX

- Outcome: clean routine updates with member control preserved.
- Reaches: existing and newly authored automations, private and group messages.
- Proof: composed prompt boundaries; real-model legacy-note, explicit-copy,
  authoring, unanswered-cue, relevant-reply, and silence scenarios.

## Tasks

1. Add focused deterministic proof for execution and authoring guidance.
2. Update the two existing prompt sections and their durable messaging owner.
3. Add synthetic live regressions and run them on Terra and Luna, including
   a relevant reply that must prevent another cadence question.
4. Run focused tests, typecheck, complexity review, and privacy review.
5. Record the release-note decision and commit the scoped repair.

## Verification

- Composed control-copy and output-history suites: 12 passed.
- Device-activity automation suite: 58 passed.
- Focused recurring-cadence runtime scenario: passed.
- Assistant Engine and hosted Web typechecks: passed.
- Changelog page rendering: 9 passed.
- Complexity: no added branches; existing unrelated hotspots retained.
- Live execution and authoring: both models passed the private/group legacy
  note, requested-footer, concrete-stop, and new-authoring scenarios.
- Final live cadence checks: both models passed relevant-reply cue-only,
  unanswered-cue question, and unanswered-question skip scenarios.
- Product UX verdict: Ready for the scoped change; all 16 synthetic scenarios
  passed across `gpt-5.6-terra` and `gpt-5.6-luna` using local subscription auth.
  Each authoring run performed exactly one mocked automation save; execution
  runs returned the expected send or skip decision with no dynamic tool calls.
  Real delivery providers and production state were not exercised.

Focused commands:

- `pnpm --filter @murphai/assistant-engine exec vitest run --no-coverage test/automation-control-copy-prompt.test.ts test/assistant-cron-output-history.test.ts test/device-activity-automations.test.ts`
- `pnpm --filter @murphai/assistant-engine exec vitest run --no-coverage test/assistant-cron-runtime.test.ts --testNamePattern "sends one recurring reminder cadence question"`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --dir apps/web test -- changelog-page.test.tsx`
- `pnpm --dir apps/web typecheck`
- `pnpm complexity:diff`
- `pnpm test:assistant:live -- --model <model> --test "<pattern>"`, once per
  supported model and each focused journey below, using an available
  authenticated local subscription profile.

Live journey patterns:

- `keeps saved control notes out of routine summaries` (four scenarios)
- `authors an ongoing activity summary without generic control boilerplate`
- `uses a relevant reply when resuming`
- `asks one cadence question`
- `skips after the unanswered cadence`

## Review and deployment

The correction stays with existing prompt owners. No state, schema, dependency,
provider call, database call, parser, or output-filtering layer is added.
Device-triggered one-time notifications carry their occurrence through the
existing turn envelope to the same repaired execution guidance. Existing
canonical records need no migration. No member data is used in source,
fixtures, documentation, or live-model proof.

This is prompt-primary work; final external review is not required by the
completion workflow. The changelog is a content-only fragment using the existing
archive rendering. Deployment is separate: the new runner must converge before
existing scheduled jobs use the new guidance; older runners can retain the old
wording. There is no protocol or persisted-state rollout order or rollback floor.

Completed: 2026-09-06
