# Keep workout routines in chat with verified saves

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal and invariant

Keep routine help in chat and distinguish proposals, verified saved templates,
and live sessions. Preserve canonical ownership and member authorization.

## Scope and current owners

Change assistant routing, strength-training instructions, and workout-save CLI help; correct the historical
Training recommendation. Use existing workout format save/show commands; add no
persistence, tools, or UI. The Training implementation and live-workout behavior
remain outside scope. The latest base already pins the training-summary test clock.

## Product UX

- Outcome: a member receives routine content and an accurate saved-state explanation in chat.
- Entry: planning, explicit saving, saved-routine retrieval, or unavailable web access.
- Journeys: unsaved proposal; explicit save and readback; existing/missing/unreadable routine;
  old Training recommendation; private versus group authority; live-workout continuity.
- Proof: composed prompt tests, real canonical writes/readback in synthetic live journeys,
  failure/no-write assertions, existing corrected date fixture, changelog rendering.
- Done when: no Training recommendation, no invented saves, no routine-save side effects
  beyond the authorized template, and focused proof plus typechecks pass.

## Tasks

1. Correct prompt, skill, product contract, and historical product announcement.
2. Add deterministic boundaries and focused real-Codex routine journeys.
3. Run relevant tests and typechecks, inspect replies and full diff, and scoped commit.

## Decisions and risks

Prompt-primary correction; no new backend enforcement or routine library. Preserve
existing generic action-honesty guidance and private/group boundaries. A failed
readback must not be reported as a successful save or trigger a duplicate write.
Existing Frog entries cover the already-fixed date-dependent summary fixture. Live
proof exposed incomplete CLI mode guidance and an invalid activity-type example;
correct the existing help metadata without changing parsing or persistence.

## Verification

- Assistant prompt/skill boundary suites: 104 tests passed.
- Training and changelog rendering suites: 39 tests passed, including the existing clock fix.
- Workout-format CLI schema, help, and persistence parity: 11 tests passed.
- Assistant Engine, CLI, and Web typechecks passed; changed Web test lint passed.
- Complexity diff passed with no new debt; existing untouched hotspots stay unchanged.
- Real-Codex five-scenario journey: passed with `gpt-5.6-terra`, low reasoning,
  local subscription. Command: `pnpm test:assistant:live -- --test
  "keeps routine drafts, verified saves, and retrieval in chat"` with the authorized
  alternate subscription home. Startup-only failures used the documented retry;
  provider-active iterations stayed on the same working profile.
- Product UX verdict: Ready. Reviewed every synthetic reply: explicit unsaved draft;
  exactly one structured save followed by matching readback; existing routine shown
  in chat; named missing routine checked directly; unreadable record explained
  without claiming absence or changing it. No live sessions, logged sets, reminders,
  response cards, or Training recommendations. Group authority remains unchanged
  and is covered by composed prompt/skill boundaries.
- Live proof also found that brief planning could bypass the skill and limited
  lists could be mistaken for definitive absence. The main prompt now carries
  draft honesty and exact named lookup rules, and skill discovery includes retrieval.
- Source review confirms no added runtime state, no mutation-handler changes, no
  route removal, and corrected public feed actions. Task files passed privacy scan.
- Final ReviewGPT is exempt: runtime edits are prompt/tool-description policy and
  static content only. No independent backend or trust-boundary behavior changes.
- No PR, merge, production mutation, or deployment has been requested.

## Deployment and follow-up

The assistant runtime release carries the prompt, skill, and CLI-help changes;
Web carries the corrected historical entry and new release note. They can deploy
in either order without schema changes. The new runtime explicitly overrides old
Training recommendations while Web catches up. Existing Training URLs remain
outside the supported recommendation flow. No production rollout performed here.

## Check commands

- `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts packages/assistant-engine/test/model-behavior.test.ts packages/assistant-engine/test/repeated-workout-tally-skill.test.ts packages/assistant-engine/test/assistant-tracked-table-skill.test.ts --no-coverage`
- `pnpm --dir apps/web test -- browser-training-view.test.ts training-page.test.tsx changelog-page.test.tsx`
- `pnpm exec vitest run --config packages/cli/vitest.config.ts packages/cli/test/workout-format-save-typed-parity.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web exec eslint test/changelog-page.test.tsx`
- `pnpm complexity:diff`
- `git diff --check`
Completed: 2026-09-08
