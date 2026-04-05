# Fix recipe upsert stdin handling and coverage

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Keep the generated `murph` and `vault-cli` shell shims from dropping piped stdin so `--input -` behaves the same through the shim path and the repo-local built CLI.

## Success criteria

- Reproduce the bad `vault-cli recipe upsert --input -` behavior through the installed shim and identify the exact mechanism.
- Land a shim-level fix that preserves stdin for non-interactive child launches without regressing the existing signal-forwarding behavior.
- Add focused regression coverage for piped stdin through the generated shim.
- Run the required package verification plus a direct built-shim stdin scenario check.

## Scope

- In scope:
- `packages/cli/src/setup-services/shell.ts`
- `packages/cli/test/setup-cli.test.ts`
- `agent-docs/operations/verification-and-runtime.md`
- Active coordination/plan artifacts for this lane
- Out of scope:
- Changing recipe validation semantics
- Broad setup/onboarding refactors
- Updating the globally installed machine shim outside repo-owned generation logic

## Constraints

- Technical constraints:
- Preserve the current shim contract that auto-rebuilds missing dist artifacts and can still hard-stop stubborn child processes on forwarded signals.
- Product/process constraints:
- Keep the fix narrow and explain the concrete failure mode in handoff because agents are currently misattributing it to recipe validation.

## Risks and mitigations

1. Risk: Fixing the stdin path could accidentally drop the signal-supervision behavior that motivated the wrapper.
   Mitigation: Keep the supervisor path, but explicitly preserve a duplicated stdin fd for backgrounded children and retain the existing signal test.

## Tasks

1. Reproduce the mismatch between the repo-local built CLI and the installed `vault-cli` shim.
2. Patch the generated shim to preserve piped stdin.
3. Add focused setup-cli regression tests for piped stdin and closed-stdin fallback through the shim path.
4. Run the required verification and direct scenario proof, then complete review/commit workflow.

## Decisions

- The bug is shim-level, not `recipe upsert`-specific: `/Users/willhay/.local/bin/vault-cli` backgrounds the built CLI when stdin or stderr is non-TTY, and that background launch currently drops piped stdin.
- When stdin is closed entirely, the shim should still launch the child under supervision with `/dev/null` rather than aborting during fd duplication.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim preserves piped stdin for supervised child launches"`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim falls back to /dev/null when stdin is closed"`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim force-stops a stubborn built child after SIGINT"`
- Direct scenario check: `printf '{' | node packages/cli/dist/bin.js recipe upsert --vault <tmp> --input - --format json`
- Direct scenario check: `printf '{' | <patched shim> /Users/<user>/.nvm/.../bin/vault-cli recipe upsert --vault <tmp> --input - --format json`
- Expected outcomes:
- Focused shim tests pass.
- The direct built-entry and patched-shim scenario checks fail with JSON-validation errors rather than a false “No recipe payload was piped to stdin.” message.
Completed: 2026-04-05
