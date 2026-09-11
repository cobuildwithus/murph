# Canonical targets for plan-dependent reminders

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Plan-dependent cues use the current canonical plan and occurrence local date.
A correction or one-day exception must not silently reset a recurring rotation.

## Owner and evidence

The plan owns rotation; automations own timing, purpose, and skip conditions.
A synthetic saved series with identical canonical references but conflicting
copied anchors produced opposite targets, including with the real model given
the full canonical plan. The scheduled context owner currently requests reads
without defining precedence between plan state and copied reminder rules.

## Approach

Extend the existing scheduled context policy and plan-support authoring guidance.
Derive targets from the existing owner; add no schema, parser, state, scheduler,
or mutation path. Existing saved instructions remain readable, with canonical
plan authority explicit at execution. Preserve explicit exceptions, pauses,
independent fixed reminders, and reminder-only consent. Unresolved targets
produce no guessed exercise or silent repair. No production data mutation.

## Product UX

Outcome: consistent cues on successive local calendar days.
Reaches: existing plan-linked reminders with conflicting copied instructions;
ordinary fixed reminders and accepted one-day pauses retain their behavior.
Proof: production-composed deterministic regression plus focused synthetic live
journeys for adjacent dates, repeat exception, pause, and missing plan context.

## Tasks

1. Add deterministic composition proof, then change the existing policy owner.
2. Update authoring and repair guidance to avoid copied plan rules.
3. Run focused tests, typecheck, real-model journey, complexity and parent review.
4. Record evidence and close with a scoped commit.

## Verification

- Deterministic regression failed before the change at the missing canonical
  target precedence, then passed after the runtime policy update.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts
  --no-coverage test/assistant-cron-runtime.test.ts
  test/assistant-cron-output-history.test.ts test/assistant-cron-schedule-store.test.ts`:
  253 passed.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed on final test code.
- `pnpm --dir apps/web test changelog-page.test.tsx`: 10 passed.
- `pnpm complexity:diff`: passed, zero added complexity or branches. Existing
  unrelated execution hotspots are unchanged.
- `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`: passed.
- Initial individual/group provider inputs are unchanged: the runtime addition
  is scheduled-only; domain reference edits are loaded on demand. No initial
  prompt/tool schema/description or resident skill catalog text changes.
- `pnpm test:assistant:live -- --test "keeps canonical rotation across adjacent dates"`
  with the already-working alternate local subscription home: passed on
  gpt-5.6-terra. Eight provider turns; zero dynamic mutation calls; canonical
  plan and automation documents unchanged. Allowed movement-guidance reads.
- UX verdict: Ready. All eight reviewed outputs matched their intended outcome:
  repeat exception, following day, conflicting same-day anchors, one-day pause,
  resume without reanchoring, unavailable owner, and independent fixed cue.
  No guessed target, completion claim, internal identifier, or extra question.
- Earlier harness-only failures were corrected: long plan text belongs in the
  regimen note, and movement guidance needs its ordinary skill path. A strict
  zero-command assertion was replaced by effect/readback proof so legitimate
  reads remain available. The final complete run passed on the same auth home.

## Parent review

The existing context builder owns runtime precedence. The current plan remains
the only target owner; automations still own schedule and skip conditions.
No new branch, parser, schema, dependency, or durable state. Source and skill
changes compose through the existing canonical reference/read boundaries.
This is prompt-primary work: no effect authority, provider transport, delivery,
or persistence implementation changes; final ReviewGPT exemption applies.
Changelog copy uses the existing archive presentation and passed its production
render test. No private feedback, identifiers, or historical member records are
included. No new repository-actionable Frog issue was encountered.

## Limits

Live evidence proves the tested model and synthetic inputs, not deterministic
arithmetic enforcement or actual member delivery. Full canonical reads are
supplied as fixture results to isolate target precedence. The change does not
rewrite production records, infer an ambiguous permanent reset, or deploy code.

Completed: 2026-09-10
