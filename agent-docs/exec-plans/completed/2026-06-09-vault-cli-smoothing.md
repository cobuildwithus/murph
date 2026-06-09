Goal (incl. success criteria):
- Smooth the `vault-cli` snags found while creating the low-back/hip PT experiment without adding framework-local hacks.
- Success means `experiment start` can capture setup answers in the same command, `automation save` accepts the singular tag flag, protocol exploration favors the best query match for custom-vs-public decisions, and tests cover the regressions.

Constraints/Assumptions:
- Keep the architecture simple and composable; prefer existing CLI/usecase primitives over new layers.
- Do not patch or wrap Incur locally for flag-casing display; treat that as an upstream Incur example-rendering concern.
- Preserve unrelated worktree edits from the main checkout by working on an isolated branch/worktree.

Key decisions:
- Handle actual Murph CLI behavior in Murph code.
- Leave example flag casing to a small upstream Incur fix that canonicalizes rendered option names the same way Incur parses them.

State:
- Verified; ready for scoped commit.

Done:
- Reproduced the CLI snags with dry-run or non-mutating commands.
- Inspected the command implementations, usecase persistence path, and Incur parser/example rendering.
- Added shared lightweight experiment onboarding option builders and reused them from both typed start and edit/apply paths.
- Added `experiment start` setup/onboarding/assistant-support flags.
- Added canonical repeated `automation --tag` support with `--tags` kept as a legacy alias.
- Adjusted protocol explore starter selection so query fallback follows the top query match.
- Updated assistant/OpenClaw skill guidance for start-time setup answers, custom fallback, automation tags, and retrieved-content-as-data boundaries.
- Ran focused tests, root typecheck, diff verification, hygiene scans, and completion audits.

Now:
- Close with the scoped finish script.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/cli/src/commands/experiment.ts
- packages/cli/src/commands/automation.ts
- packages/cli/src/commands/commons.ts
- packages/vault-usecases/src/experiment-onboarding-options.ts
- packages/vault-usecases/src/index.ts
- packages/vault-usecases/src/usecases/experiment-journal-vault.ts
- packages/cli/config.schema.json
- packages/cli/src/incur.generated.ts
- packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts
- packages/cli/test/automation.test.ts
- packages/cli/test/commons-command-coverage.test.ts
- packages/assistant-engine/skills/experiment-onboarding/SKILL.md
- packages/assistant-engine/test/experiment-onboarding-skill-guidance.test.ts
- packages/openclaw-plugin/skills/murph/SKILL.md
- packages/openclaw-plugin/test/package.test.ts
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
