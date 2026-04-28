# Worker 05: CLI And Inbox Cut

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; you may spawn your own focused subagents for bounded exploration or review. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `ARCHITECTURE.md`
- CLI notes in `agent-docs/operations/verification-and-runtime.md`

## Ownership

You own CLI/setup/inbox model route surfaces:

- `packages/cli/src/commands/model.ts`
- `packages/cli/src/commands/inbox.ts`
- `packages/cli/src/inbox-model-runtime.ts`
- `packages/cli/src/inbox-model-harness.ts`
- `packages/cli/src/inbox-model-contracts.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/assistant-cli/src/**`
- `packages/setup-cli/src/**`
- directly coupled CLI/setup tests only when required

Avoid operator-config internals except through exported contracts from Worker 01. Avoid assistant-engine runtime edits except tiny compile fixes.

## Goal

Make the CLI assistant/model setup surface Codex-only and delete/disable AI SDK-backed inbox model routing.

## Required Behavior

- Assistant `ask`, `chat`, `run`, model setup, and setup wizard flows should no longer expose OpenAI-compatible provider runtime flags.
- Remove or fail closed for assistant flags such as:
  - `--base-url`
  - `--api-key-env`
  - `--provider-name`
  - `--headers-json`
  - OpenAI-compatible provider preset selection
  - gateway-only provider options
  - zero-data-retention options
- Keep Codex options:
  - model
  - modelProvider if surfaced
  - Codex command
  - Codex profile
  - Codex home if already supported
  - reasoning effort
  - sandbox
  - OSS/local provider where existing Codex CLI supports it
- Disable/delete `inbox model route` if it depends on AI SDK/OpenAI-compatible runtime.
- Preserve deterministic `inbox model bundle` if it does not call a model and remains useful.
- Regenerate incur generated artifacts if command topology changes.

## User Decisions

The user does not care about preserving `inbox model route`.
The user wants as much duplicate runtime complexity deleted as possible.

## Verification

Run focused CLI checks if possible:

```sh
pnpm --dir packages/cli typecheck
pnpm --dir packages/cli test -- assistant
pnpm --dir packages/cli test -- inbox-model
```

If generated incur metadata needs refresh and the generator is blocked by other workers, report the exact command and blocker.

Final message must list removed CLI flags/commands, generated files touched, tests run, and any remaining CLI AI SDK residue.
