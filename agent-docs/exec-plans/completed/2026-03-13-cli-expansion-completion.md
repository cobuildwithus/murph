# Finish remaining vault-facing CLI expansion plan

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Define the concrete user-visible and engineering outcome.

## Success criteria

- List objective checks required to call this done.

## Scope

- In scope:
- Out of scope:

## Constraints

- Technical constraints:
- Product/process constraints:

## Risks and mitigations

1. Risk:
   Mitigation:

## Tasks

1. Replace with ordered concrete tasks.

## Decisions

- None yet.

## Verification

- Commands to run:
- Expected outcomes:
Goal (incl. success criteria):
- Implement only the remaining journal/experiment/vault mutation slice the user assigned in this turn.
- Success means the owned core helpers and CLI command modules support journal append/link/unlink mutations, experiment update/checkpoint/stop, and `vault update --title/--timezone`, with focused tests proving the canonical writes.

Constraints/Assumptions:
- Preserve adjacent edits from active CLI lanes; do not revert or rewrite unrelated work.
- Respect the current trust boundary: only `packages/core` mutates canonical vault data.
- The user restricted ownership to `packages/core/src/journal/api.ts`, `packages/core/src/experiments/api.ts`, `packages/core/src/vault-update.ts`, `packages/cli/src/commands/journal.ts`, `packages/cli/src/commands/experiment.ts`, `packages/cli/src/commands/vault.ts`, `packages/cli/src/commands/experiment-journal-vault-read-helpers.ts`, and `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`.
- The user explicitly forbade editing shared exports/registration/docs/smoke files, so any required integration outside the owned set must be reported as follow-up instead of changed here.

Key decisions:
- Narrow the lane to the mutation helpers and focused test coverage the user explicitly assigned.
- Avoid touching `packages/core/src/index.ts`, `packages/core/src/public-mutations.ts`, and `packages/cli/src/vault-cli.ts`; verify whether the new command modules can be exercised from focused tests without shared export edits.
- If registration/export follow-up is required for end-to-end CLI exposure, document the exact missing file changes in handoff rather than breaking ownership.

State:
- in_progress

Done:
- Re-read the workspace routing, architecture, reliability/security, verification, and completion-workflow docs.
- Reviewed the current coordination ledger and narrowed the active row to the exact files and symbols assigned in this turn.

Now:
- Inspect the owned core/CLI/test files to map existing journal, experiment, and vault read/write plumbing before editing.

Next:
- Implement the owned canonical write helpers, wire the owned command modules and helper file, add the focused test, then run completion audits and required verification.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether end-to-end CLI registration for any new subcommands can be completed without touching `packages/cli/src/vault-cli.ts`.
- UNCONFIRMED: whether any public export follow-up beyond the owned files is required for package consumers outside the focused tests.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-cli-expansion-completion.md`
- `packages/core/src/journal/api.ts`
- `packages/core/src/experiments/api.ts`
- `packages/core/src/vault-update.ts`
- `packages/cli/src/commands/journal.ts`
- `packages/cli/src/commands/experiment.ts`
- `packages/cli/src/commands/vault.ts`
- `packages/cli/src/commands/experiment-journal-vault-read-helpers.ts`
- `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Completed: 2026-03-13
