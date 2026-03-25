# Assistant command registration refactor

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Reduce duplicated assistant CLI option-to-service mapping inside `packages/cli/src/commands/assistant.ts`.
- Split the monolithic assistant command registration into smaller local helpers without changing the public command tree.
- Centralize repeated redacted assistant-state path formatting so session/memory outputs stay aligned.

## Success criteria

- `assistant ask`, `assistant chat`, `assistant deliver`, `assistant cron add`, and `assistant cron preset install` reuse shared pure mapping helpers for conversation, provider, and delivery fields.
- Session and memory commands reuse small redacted-path helpers instead of inlining the same state-root formatting.
- Root `chat` and `run` aliases still derive from the same command-definition factories as the assistant subcommands.
- Command names, option schemas, examples, hints, help strings, and result envelopes stay unchanged unless a targeted regression test proves otherwise.

## Scope

- In scope:
  - `packages/cli/src/commands/assistant.ts`
  - focused assistant CLI and schema tests if the refactor reveals a regression
- Out of scope:
  - assistant runtime/service behavior changes
  - new CLI options, schema fields, or help copy
  - generated topology changes outside the existing root alias factories

## Constraints

- Behavior-preserving refactor only.
- Preserve saved-default-vault behavior and existing redaction semantics.
- Preserve current dirty worktree edits that already touch nearby assistant command code.

## Risks and mitigations

1. Risk: refactoring helper boundaries changes schema/help metadata indirectly.
   Mitigation: keep command definitions/data literals intact and only move shared mapping/path formatting into local pure helpers.
2. Risk: root alias parity drifts from `assistant chat` or `assistant run`.
   Mitigation: keep alias registration factory-based and re-run the focused schema smoke tests.
3. Risk: nearby in-flight assistant edits in this worktree get overwritten.
   Mitigation: make a narrow single-file refactor on top of the current file state and avoid reverting adjacent changes.

## Tasks

1. Extract local helpers for conversation, provider, and delivery option mapping plus assistant-state path redaction.
2. Split `registerAssistantCommands` into smaller registration helpers by conversation, memory, cron, and session areas while keeping the router tree identical.
3. Reuse the shared helpers in the existing handlers and keep root alias factories unchanged.
4. Run focused assistant CLI/schema verification and record exact outcomes.

## Verification

- Focused commands:
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1 -t "assistant session list and show expose assistant-state metadata through the CLI|assistant cron add/list/show/status/disable/enable/remove expose typed scheduler records through the CLI|assistant cron preset list/show/install expose built-in templates and materialize jobs through the CLI"`
  - `pnpm exec vitest --configLoader runner run packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1 -t "root chat alias keeps the same command schema as assistant chat|root run alias keeps the same command schema as assistant run|assistant cron preset install schema exposes preset variables, instructions, and delivery options"`
  - `node --input-type=module -e "...source-schema-checks..."`
- Additional command:
  - `pnpm typecheck`

## Outcome

- Added shared CLI-to-service mapping helpers for assistant conversation fields, provider overrides, and delivery overrides.
- Centralized redacted assistant-state path formatting for vault-only, state-root, memory, session, and cron result payloads.
- Split `registerAssistantCommands` into smaller registration helpers for conversation, memory, cron, session, and root alias areas while preserving the command tree.

## Verification results

- Passed:
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1 -t "assistant session list and show expose assistant-state metadata through the CLI|assistant cron add/list/show/status/disable/enable/remove expose typed scheduler records through the CLI|assistant cron preset list/show/install expose built-in templates and materialize jobs through the CLI"`
  - `pnpm exec vitest --configLoader runner run packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1 -t "root chat alias keeps the same command schema as assistant chat|root run alias keeps the same command schema as assistant run|assistant cron preset install schema exposes preset variables, instructions, and delivery options"`
  - `node --input-type=module -e "...source-schema-checks..."` confirmed source-level `chat`/`assistant chat` schema parity, source-level `run`/`assistant run` schema parity, and presence of `var`, `instructions`, and `deliverResponse` on `assistant cron preset install`.
- Failed for environment or unrelated pre-existing reasons:
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1 -t "assistant commands use the saved default vault when --vault is omitted and still allow explicit overrides"`
    - fails because `runSourceCli` uses `tsx/cli`, which attempts to open a local IPC pipe and is denied in this sandbox (`node:net ... listen EPERM ... tsx-*.pipe`) before the CLI emits JSON.
  - `pnpm --dir packages/cli typecheck`
    - fails on pre-existing missing-built-artifact and typing issues across unrelated CLI files plus sibling workspace packages.
  - `pnpm --dir packages/cli build`
    - fails on pre-existing cross-workspace source-resolution/rootDir issues unrelated to `packages/cli/src/commands/assistant.ts`.
