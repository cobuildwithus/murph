# Verify inbox daemon PID ownership before stop

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Prevent `inbox stop` from signaling unrelated local processes when mutable inbox daemon PID state is stale, corrupted, or points at a reused PID.
- Keep the CLI command thin and preserve the public inbox daemon state contract while storing process-control proof as private machine-local runtime state.

## Success criteria

- `inbox run` records enough private process identity for the current daemon PID.
- `inbox stop` verifies daemon ownership before `SIGCONT`/`SIGTERM` and re-verifies before any `SIGKILL`.
- Missing, mismatched, or unverifiable live ownership sends no signal without clearing the running state.
- Dead recorded PIDs are still normalized to stale.
- Public `InboxDaemonState` output remains free of process-control internals.
- Focused runtime-state and inbox-services tests cover matching, mismatch, stale, and stop fail-closed behavior.

## Scope

- In scope:
- `@murphai/runtime-state/node` process identity helper.
- Inbox daemon persisted/private state handling and stop ownership verification in `packages/inbox-services`.
- Focused runtime-state and inbox-services tests.
- Out of scope:
- Redesigning inbox into a background HTTP/socket daemon.
- Hardening assistant/device stop paths in this change, though the helper should be reusable later.

## Constraints

- Technical constraints:
- `packages/cli/src/commands/inbox.ts` should remain delegation-only.
- Do not add process identity fields to `packages/operator-config` public CLI output schemas.
- New process-control state must stay machine-local operational residue under `.runtime/operations/inbox/**`.
- Product/process constraints:
- Preserve unrelated dirty working-tree edits and active ledger rows.

## Risks and mitigations

1. Risk:
   Existing running inbox state lacks process identity and cannot be safely stopped by PID after upgrade.
   Mitigation:
   Refuse process-control signals while leaving live state running so `inbox run` does not start a duplicate daemon.
2. Risk:
   Platform-specific process metadata can be unavailable or lower precision outside Linux.
   Mitigation:
   Use Linux `/proc/<pid>/stat` where available and a macOS `ps lstart` token for local developer support; unsupported platforms fail closed before signaling.

## Tasks

1. Add a small reusable runtime-state process identity helper.
2. Split inbox daemon disk persistence from the public CLI projection.
3. Verify ownership in inbox stop before all signals.
4. Add focused regression tests.
5. Run required checks and completion audits.

## Decisions

- Use an internal persisted inbox daemon state schema rather than changing `InboxDaemonState`.
- Keep process identity generic in runtime-state so assistant/device stop paths can reuse it later.
- Use Linux `/proc/<pid>/stat` start tokens where available.
- Use macOS `ps lstart` as a minimal local-development fallback; it avoids command lines, paths, and usernames but is lower precision than Linux proc ticks.

## Verification

- Commands to run:
- `pnpm --dir packages/runtime-state test -- process-identity`
- `pnpm --dir packages/inbox-services test -- inbox-services-core-seams inbox-app-reads-runtime`
- `pnpm typecheck`
- Coverage-bearing package verification per repo workflow.
- Expected outcomes:
- Focused tests and typecheck pass.
Completed: 2026-05-06
