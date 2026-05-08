Goal (incl. success criteria):
- Reduce foreground hosted assistant latency by avoiding unconditional inbox sidecar rebuilds before Codex runtime setup.
- Add sanitized timing around hosted inbox sidecar bootstrap so local sidecar cost is visible without logging user content or filesystem paths.
- Preserve mailbox import, assistant admission, and best-effort inbox projection behavior.

Constraints/Assumptions:
- Do not expose local account identifiers, filesystem roots, mailbox payloads, prompts, transcripts, or vault contents in logs or docs.
- Preserve the existing best-effort sidecar failure posture for foreground hosted runs.
- Coordinate with the active hosted inbox sidecar bootstrap row and keep this change narrow.

Key decisions:
- Use the in-process sidecar readiness map plus restore coldness to decide whether foreground bootstrap needs a rebuild.
- Keep timing metadata to request id, rebuild flag, readiness result, and elapsed milliseconds.

State:
- Implementation and focused verification complete; closeout/commit is pending dirty-worktree coordination.

Done:
- Identified unconditional `rebuild: true` in `runHostedWorkspaceRuntimeJobInProcess`.
- Added sidecar readiness/cold-restore gating and sanitized timing logs.
- Security review found stale ready-map risk on cold restore; fixed by invalidating sidecar readiness when cold restore occurs.
- Added regression coverage for null-bootstrap no-rebuild, cold-restore rebuild after prior readiness, readiness key normalization, invalidation, and sanitized timing logs.
- Verification passed for assistant-runtime focused/full package test surface, package coverage, package typecheck, and diff check.
- Security/privacy, coverage-write, and task-finish review passes completed.

Now:
- Close or archive plan if a scoped commit can be made safely.

Next:
- Report any commit blocker caused by overlapping unrelated dirty files.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts`
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
