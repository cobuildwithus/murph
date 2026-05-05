# Add deterministic experiment follow-up due primitive

Status: completed
Created: 2026-04-27
Updated: 2026-05-06

## Goal

- Add a deterministic CLI/query primitive that answers whether an experiment follow-up is due, so scheduled automations can call product logic instead of embedding business rules in automation prose.

## Success criteria

- `vault-cli experiment followup due <experiment> --kind missed-log --format json` returns a stable decision with `notify` or `skip`, a reason, the relevant session date/window, and a dedupe key.
- The same primitive supports weekly digest due checks for experiments that have weekly digests enabled and are on their 7-day cadence from intervention start.
- Missed-log checks are conservative: daily schedules can notify when a planned session is unlogged, while unsupported non-daily schedules skip instead of guessing.
- CLI and query tests cover notify, already-logged skip, opt-out skip, unsupported schedule skip, and weekly digest behavior.
- Existing canonical automation/cron delivery remains the notification primitive; this task does not introduce a second delivery system.

## Scope

- In scope:
- `packages/query/src/experiments.ts` and directly coupled query tests.
- `packages/vault-usecases/src/usecases/{experiment-journal-vault.ts,types.ts}` if needed for the CLI service boundary.
- `packages/cli/src/commands/experiment.ts`, generated CLI metadata if required, and directly coupled CLI tests.
- Assistant/product guidance that currently frames experiment notifications as requiring separate opt-in.
- This plan and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Out of scope:
- New notification transports, cron storage formats, or assistant cron execution rewrites.
- Automatically creating canonical automation records for every experiment setup in this slice.
- Suggested copy generation inside the due primitive.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not expose personal identifiers or delivery addresses in code, docs, tests, logs, or handoff.
- Reuse canonical automation and assistant cron delivery as the execution layer.
- Keep the due decision deterministic and free of LLM prose decisions.

## Risks and mitigations

1. Risk: naive schedule inference sends false reminders for non-daily protocols.
   Mitigation: v1 only notifies for daily/every-intervention-day plans and returns an unsupported-schedule skip for anything less clear.
2. Risk: dedupe semantics get split between product and delivery layers.
   Mitigation: due output includes a stable semantic dedupe key, while sent-state enforcement remains with existing cron/outbox dedupe.
3. Risk: product guidance conflicts with existing onboarding safety constraints.
   Mitigation: update language to default-on after a confirmed experiment plan while preserving clear opt-out and no surprise pre-confirmation automation.

## Tasks

1. Completed: inspect existing experiment progress, assistant support, automation, and cron notification surfaces.
2. Completed: add the query/usecase/CLI due primitive.
3. Completed: add focused query and CLI coverage.
4. Completed: update assistant/product guidance for default-on confirmed experiment follow-ups.
5. In progress: run scoped verification, required audit passes, and close/commit or document blockers.

## Decisions

- Do not include suggested copy in the primitive; the result should be a machine-readable due decision only.
- Keep delivery on existing canonical automation/cron notification primitives.
- Treat `remindersEnabled: true` plus `missedLogFollowup !== "never"` as enough for a confirmed experiment follow-up; `never` remains the opt-out.
- Bound weekly digest notifications to the intervention window so an active experiment left in review-due state does not keep emitting weekly digest due decisions.
- Do not include the local vault path in `experiment followup due` results; callers already know the vault they invoked and notification decisions should not carry filesystem details.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched paths>`
- `pnpm test:smoke`
- focused direct CLI/query proof for the new command
- `git diff --check -- <touched paths>`
- required `security-privacy-review`, `coverage-write`, and `task-finish-review` passes
- Current outcomes:
- `pnpm exec vitest run packages/query/test/experiment-analysis.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/cli gen:config-schema` passed.
- `pnpm build` passed and refreshed the local `vault-cli` shim target.
- Direct built CLI proof passed: `experiment followup due daily-sauna-2026-04-27 --kind weekly-digest --date 2026-05-18` returns `skip` / `weekly_digest_not_due` and no top-level `vault` key.
Completed: 2026-05-06
