# Add reusable workout formats composable with workout quick capture

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Add a reusable workout-format surface that stores common workout structures once and lets operators log real workout events from those saved formats without re-entering the full set/rep detail each time.
- Keep the current `workout add` quick-capture flow intact and composable with the new surface instead of introducing a parallel workout system.

## Success criteria

- Operators can save a reusable workout format with the minimum stable structure needed for repeat logging.
- Operators can inspect saved workout formats through intuitive CLI commands.
- Operators can create a dated workout event from a saved format while overriding occurrence time and any session-specific note fields that still vary.
- Existing freeform `workout add` logging continues to work, including current duration/type inference and structured strength capture.
- Focused tests cover the new format write/read path plus event creation from a saved format.

## Scope

- In scope:
- a thin reusable workout-format registry or equivalent canonical surface that fits the existing vault/event model
- CLI commands for creating and reading reusable workout formats
- wiring from the reusable format surface into one-off workout event creation
- focused docs, manifest, and regression coverage needed to keep the CLI truthful
- Out of scope:
- device-import workout changes
- a full training-program planner, scheduler, or calendar system
- broad changes to activity-session event semantics beyond the minimum linkage needed for reusable formats

## Constraints

- Technical constraints:
- preserve the current `workout add` path and existing `activity_session` write ownership through core mutation ports
- keep the new surface additive and modular; avoid inventing a heavyweight second model for workouts
- preserve existing structured strength-session capture behavior
- Product/process constraints:
- keep the CLI intuitive and low-surface-area for operators
- follow the coordination ledger hard gate before code changes
- run the user-requested `review:gpt` autosend flow with a focused implementation brief before implementation
- update architecture/docs if the final design introduces a new durable product surface

## Risks and mitigations

1. Risk: a reusable-workout surface duplicates or fights the existing quick-capture/event flow.
   Mitigation: design it as a thin source-of-defaults layer that feeds the same event path rather than a separate workout subsystem.
2. Risk: overlap with the active structured-workout lane makes it easy to trample adjacent edits or regress strength exercise capture.
   Mitigation: preserve the existing workout files' current behavior, scope changes narrowly, and add focused regressions around the strength-exercise path.
3. Risk: the CLI becomes cluttered if formats and event logging are split across too many verbs.
   Mitigation: prefer one small reusable-format surface plus one obvious path for logging an event from a saved format.

## Tasks

1. Read the current workout/event implementation and active overlap, then send a focused implementation brief through `pnpm review:gpt --send`.
2. Decide the thinnest reusable-format model and CLI shape that composes with `workout add`.
3. Implement the canonical storage/read/write path plus CLI wiring and focused docs.
4. Add focused tests for saving formats and logging events from them without regressing existing quick capture.
5. Run required verification, capture review outcomes, and close the lane cleanly.

## Decisions

- Keep the public shape thin and nested under `workout format`: `save`, `show`, `list`, and `log`.
- Store saved formats as vault-local Markdown docs under `bank/workout-formats/<slug>.md` with only reusable defaults: saved note text plus optional duration/type/distance fields.
- Reuse the existing workout inference path by extracting `resolveWorkoutCapture(...)` from `packages/cli/src/usecases/workout.ts`; use it both to validate saved defaults up front and to preserve the current strength-exercise inference when logging a saved format.
- Keep `workout add` intact and treat `workout format log` as a thin source-of-defaults wrapper around the same canonical `activity_session` event write path.
- Update the repo verification entrypoints so the new `packages/cli/test/cli-expansion-workout.test.ts` file is exercised by the real root Vitest include list and `pnpm verify:cli`.

## Verification

- Focused automated checks:
- `pnpm exec vitest run packages/cli/test/assistant-cli.test.ts packages/cli/test/cli-expansion-workout.test.ts --no-coverage --maxWorkers 1`
  Result: passed (`2` files, `33` tests).
- Direct scenario proof:
- `node packages/cli/dist/bin.js init --vault <tmp> --format json`
- `node packages/cli/dist/bin.js workout format save "Push Day A" "20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides." --vault <tmp> --format json`
- `node packages/cli/dist/bin.js workout format log "Push Day A" --occurred-at "2026-03-12T17:30:00Z" --vault <tmp> --format json`
  Result: passed; save returned `bank/workout-formats/push-day-a.md`, and log returned a canonical `activity_session` event with `activityType: "strength-training"`, `durationMinutes: 20`, and two inferred `strengthExercises`.
- Required repo checks:
- `pnpm typecheck`
  Result: failed for pre-existing unrelated typing errors in `packages/cli/test/assistant-service.test.ts` (missing required assistant provider fields in existing test fixtures). The transient `workout-format.ts` typing issues found earlier were fixed before the final rerun.
- `pnpm test`
  Result: failed before the CLI suite in `packages/contracts/dist/scripts/verify.js` because the existing dirty tree expects `audit-record.schema.json` to include `workout_format_upsert`, but the generated artifact is stale.
- `pnpm test:coverage`
  Result: failed at the same pre-existing stale-contract-artifact check in `packages/contracts/dist/scripts/verify.js`.
Completed: 2026-03-28
