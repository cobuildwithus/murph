# Browser Vault Refresh Foreground Guard

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Make the hosted runner alarm path explicitly yield browser-vault refresh wakes to foreground or active runner lifecycle work.

## Success criteria

- A due browser-vault refresh wake does not run ahead of pending foreground work, pending nudges, persisted active invocations, or a local invocation lock.
- A focused alarm regression covers foreground work starting while browser-vault refresh is pending.
- No new runner architecture, persisted state shape, or control-plane surface is introduced.
- Focused Cloudflare verification passes, or any unrelated blocker is recorded precisely.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts` browser-vault refresh guard logic.
  - Focused `apps/cloudflare/test/user-runner-alarm.test.ts` regression coverage.
- Out of scope:
  - New scheduler abstractions.
  - Browser-vault replica format, storage, or web control-plane changes.
  - Hosted-local E2E expansion unless focused tests expose a broader fault.

## Constraints

- Preserve Cloudflare as execution/lifecycle coordinator only.
- Foreground user work owns the Durable Object alarm over detached maintenance refreshes.
- Preserve unrelated dirty worktree edits and active hosted runner rows.
- Do not expose secrets, raw payloads, identifiers, local usernames, or home paths in code, tests, docs, logs, or handoff.

## Tasks

1. Inspect the alarm and browser-vault refresh paths.
2. Add the explicit foreground/lifecycle guard.
3. Add or strengthen focused regression coverage.
4. Run focused verification, required audits, and privacy review.
5. Commit through `scripts/finish-task` if the scoped commit is safe.

## Decisions

- Keep the change local to existing browser-vault refresh eligibility checks.
- Keep `invocationLock` deferral scoped to alarm-driven browser-vault refresh wakes so the existing post-idle-checkpoint detached refresh path still runs after a committed checkpoint.

## Verification

- Commands to run:
  - Focused Cloudflare Vitest for `user-runner-alarm.test.ts`.
  - `pnpm test:diff` scoped to touched Cloudflare files if feasible.
  - `pnpm typecheck` unless blocked by unrelated dirty work.

## Current evidence

- Initial inspection found target Cloudflare runner files clean, with unrelated dirty work in runner-state and CLI/Murph Age files.
- Focused browser-vault subset initially exposed that applying the invocation-lock guard to all detached refresh execution would break the existing committed-idle-checkpoint refresh path; the guard was narrowed to alarm-driven refresh wakes.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts -t "defers a due browser-vault refresh alarm while foreground invocation lock is active" --no-coverage` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-11-browser-vault-refresh-foreground-guard.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` failed in the `apps/cloudflare verify` lane because of unrelated active worktree failures in runner-state/idle-checkpoint tests and Health Commons runner-bundle staging.
