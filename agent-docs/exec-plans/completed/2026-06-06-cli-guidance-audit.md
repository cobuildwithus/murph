Goal (incl. success criteria):
- Audit hot `vault-cli` guidance surfaces and improve incomplete or confusing option descriptions/examples that agents see through `--help`, `--schema`, and `--llms-full`.
- Keep changes limited to command metadata, generated CLI schema/type artifacts, and focused regression tests.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits.
- Prefer concise descriptions over new command abstractions.
- Do not change command runtime behavior unless a description cannot be made truthful without a small metadata-only correction.

Key decisions:
- Start with assistant hot paths: supplement, meal, food, event, measurement, workout, regimen, experiment, journal, memory, automation, and samples.
- Prioritize repeatable/structured flags and examples that agents might copy directly.

State:
- Active.

Done:
- Supplement `--ingredient` guidance improved before scope broadened.
- Audited hot-path `--llms-full`/`--schema` surfaces and identified copyability gaps in meal, food, measurement, automation, workout, workout-format, and scheduled-log examples.
- Patched hot write-path metadata so repeatable and compact structured flags explain quoting, repetition, and comma-delimiter pitfalls.
- Added focused guidance regression tests across supplement, meal, food, measurement, automation, scheduled-log, workout, and workout-format.
- Regenerated `packages/cli/config.schema.json`.
- Verification: focused CLI tests passed; CLI diff verification passed; `git diff --check` passed.

Now:
- Close the plan and commit the scoped CLI guidance changes.

Next:
- Handoff with the unrelated workspace typecheck failure clearly noted.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/cli/src/commands/**`
- `packages/cli/test/**`
- `packages/cli/config.schema.json`
- `packages/cli/src/incur.generated.ts`
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
