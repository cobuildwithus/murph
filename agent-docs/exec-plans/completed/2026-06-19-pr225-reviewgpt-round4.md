# PR 225 ReviewGPT Round 4

## Goal

Fix accepted ReviewGPT round 4 finding for PR 225:

- Email identity-plus-thread route compatibility must depend on local transport capability, not queue-only dispatch mode.
- Hosted CLI bridge writes and hosted execution must require an explicit email delivery target.
- Local queue-only execution must preserve existing identity-plus-thread email route support.

## Constraints

- Keep this as option plumbing on the existing route validator.
- Do not add a new route type, transport registry, or migration path.
- Preserve hosted identity-less explicit target support.

## Files

- `packages/cli/src/commands/automation.ts`
- `packages/cli/test/automation.test.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`

## Verification Plan

- Focused CLI automation tests for hosted/local email route validation.
- Focused assistant cron runtime tests for hosted and local queue-only email thread routes.
- Package typechecks.
- `test:diff` for changed files.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
