# Remove assistant current-route env fallback

## Goal

Delete the ambient assistant current-route env fallback so assistant-created
reminders and automations must carry explicit route data, or hosted callers must
use the hosted CLI runtime bridge.

## Scope

- Remove the current-route env constants/helpers.
- Stop injecting current-route env into Codex turn execution plans.
- Remove local CLI/cron fallback behavior that inferred omitted delivery targets
  from process env.
- Update focused tests to require explicit route data.

## Constraints

- Preserve unrelated active work in `packages/assistant-engine/src/assistant-codex.ts`
  and Cloudflare hosted-runtime files.
- Keep hosted current-route behavior on the existing CLI bridge.
- Do not add compatibility shims or new ambient state.

## Verification

- Run focused package tests for touched assistant-engine and CLI/operator-config
  behavior.
- Run `pnpm typecheck` unless blocked by unrelated active work.

## Result

- Removed the ambient current-route env constants/helpers and the Codex
  per-turn route env injection.
- Kept hosted current-route lookup on the CLI bridge.
- Updated automation and cron save paths to require explicit deliverable routes
  outside the hosted bridge.
- Focused CLI and assistant-engine typechecks/tests pass.
- `scripts/workspace-verify.sh test:diff ...` currently fails in the
  unrelated dirty assistant Codex runtime work before reaching Cloudflare.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
