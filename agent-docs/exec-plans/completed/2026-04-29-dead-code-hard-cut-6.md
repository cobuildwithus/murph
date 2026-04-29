# Dead Code Hard Cut 6

Status: completed
Owner: Codex
Started: 2026-04-29

## Goal

Remove the smaller high-confidence dead code candidates identified in the
assistant and hosted runtime packages.

Success criteria:

- The stale assistant memory barrel is removed, and any test-only callers stop
  depending on that private alias.
- The obsolete assistant state document write lock path is removed, leaving the
  active runtime write lock and cron lock paths intact.
- The undocumented assistant-cli `assistant/daemon-client` deep alias is
  removed without changing the top-level daemon client.
- The unused current-thread reminder helper is removed rather than wired into a
  new command surface.
- The stale hosted-runtime browser-vault export helper and its direct coverage
  are removed without touching the live browser-vault dashboard code elsewhere.
- Focused residue scans and package verification prove no live imports remain.

## Scope

In scope:

- `packages/assistant-engine/src/assistant/memory.ts`
- `packages/assistant-engine/src/assistant/state/locking.ts`
- `packages/assistant-engine/src/assistant/cron/current-thread-reminder.ts`
- `packages/assistant-cli/src/assistant/daemon-client.ts`
- `packages/assistant-runtime/src/hosted-runtime/browser-vault.ts`
- Direct tests that import only those stale files or aliases.

Out of scope:

- Live browser-vault projection code outside the stale hosted-runtime helper.
- Current assistant runtime write locking.
- Current assistant cron authoring, scheduling, and delivery behavior.
- Package public exports that are still intentional top-level seams.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not write local usernames, home paths, legal names, or direct personal
  identifiers into files, logs, prompts, tests, or handoff.
- Hard cut: do not keep compatibility aliases for the removed private paths.

## Plan

1. Trace candidate source and test references.
2. Delete stale source files and update/remove direct stale tests.
3. Run residue scans over source/tests.
4. Run focused verification for the touched owners plus required audits.
5. Close the plan and create a scoped commit if the dirty checkout permits it.

## Verification Log

- Passed: `git diff --check -- packages/assistant-engine/src/assistant/memory.ts packages/assistant-engine/src/assistant/state/locking.ts packages/assistant-engine/src/assistant/cron/current-thread-reminder.ts packages/assistant-cli/src/assistant/daemon-client.ts packages/assistant-runtime/src/hosted-runtime/browser-vault.ts packages/assistant-runtime/test/hosted-runtime-browser-vault.test.ts packages/cli/test/assistant-cli.test.ts packages/assistant-cli/test/assistant-daemon-runtime-barrels.test.ts packages/assistant-cli/test/assistant-runtime-service-seams.test.ts packages/assistant-engine/test/assistant-state-locking.test.ts packages/assistant-engine/test/assistant-lock-message-wrappers.test.ts packages/assistant-engine/test/assistant-lock-message-branches.test.ts`.
- Passed: residue scan across `packages apps scripts e2e config` for removed stale symbols and private import paths found no live matches.
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-state-locking.test.ts test/assistant-lock-message-wrappers.test.ts test/assistant-lock-message-branches.test.ts`.
- Passed: `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-daemon-runtime-barrels.test.ts test/assistant-runtime-service-seams.test.ts`.
- Blocked unrelated: `bash scripts/workspace-verify.sh test:diff <touched paths>` failed in `packages/assistant-engine typecheck` on active provider/cron hard-cut errors outside this deletion slice.
- Blocked unrelated: `pnpm typecheck` failed in `packages/assistant-engine typecheck` on active provider/cron hard-cut errors outside this deletion slice.
- Blocked unrelated: `pnpm --dir packages/assistant-runtime typecheck`, `pnpm --dir packages/cli typecheck`, and focused CLI `assistant-cli.test.ts` are blocked through the same active assistant-engine provider hard-cut state.
- Audit: `security-privacy-review` reported no findings.
- Audit: `coverage-write` made no file changes and reported the existing residue/package-surface proof was sufficient.
Updated: 2026-04-29
Completed: 2026-04-29
