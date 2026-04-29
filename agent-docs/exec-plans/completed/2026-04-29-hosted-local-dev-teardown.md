# Fix hosted local dev teardown on Ctrl-C

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Make root `pnpm dev` tear down the hosted local stack reliably when the operator presses Ctrl-C.
- Ensure the web dev server, Stripe listener, Wrangler/workerd process chain, and generated Cloudflare `.dev.vars` symlink/backup are cleaned up before the root launcher exits.

## Success criteria

- Ctrl-C / `SIGINT` is represented by a focused test that awaits stack cleanup instead of letting the root launcher exit while children remain orphaned.
- Stopping the stack terminates tracked child process trees and performs temporary input cleanup exactly once.
- Focused `scripts/dev-hosted-local` tests pass.
- No secrets or local absolute identifiers are added to tracked files.

## Scope

- In scope:
  - `scripts/dev-hosted-local/main.ts`
  - `scripts/dev-hosted-local/runtime.ts`
  - `scripts/dev-hosted-local/stack.ts`
  - Direct tests under `scripts/dev-hosted-local/*.test.ts`
- Out of scope:
  - Hosted runtime provider selection.
  - Cloudflare worker runtime behavior after startup.
  - Vercel env configuration.

## Constraints

- Technical constraints:
  - Preserve existing local dev env precedence and generated config behavior.
  - Keep cleanup best-effort on partial startup failures.
  - Do not print or persist secret env values.
- Product/process constraints:
  - Preserve unrelated dirty work in the checkout.

## Risks and mitigations

1. Risk: Over-broad process cleanup kills unrelated workerd instances.
   Mitigation: terminate only tracked child process trees and leave unrelated old workerd port-0 instances alone.
2. Risk: `.dev.vars` restoration deletes a user's real local file.
   Mitigation: keep the existing backup/restore path and only make launcher-owned cleanup deterministic.

## Tasks

1. Reproduce/confirm lingering local stack symptoms.
2. Patch root signal handling so cleanup is the awaited exit path.
3. Harden child/process-tree cleanup if tests expose a gap.
4. Add focused regression tests for signal cleanup and stack stop behavior.
5. Run scoped verification and required completion workflow.

## Decisions

- Use the existing local process-tree terminator rather than adding broad port-based cleanup.
- Keep `main.ts` teardown single-flight: signal-triggered cleanup and child-exit cleanup share one stack stop promise, so a late Ctrl-C cannot invoke stack cleanup twice.

## Verification

- `git diff --check -- scripts/dev-hosted-local/main.ts scripts/dev-hosted-local/main.test.ts agent-docs/exec-plans/active/2026-04-29-hosted-local-dev-teardown.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/main.test.ts scripts/dev-hosted-local/runtime.test.ts scripts/dev-hosted-local/stack.test.ts` passed: 3 files, 33 tests.
- `pnpm typecheck` failed in an unrelated active lane: `packages/cli test/assistant-codex.test.ts(383,7)` still expects approval policy type `"never"` but fixture value is `"on-request"`.
Completed: 2026-04-29
