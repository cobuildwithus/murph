# Hosted Idle-Only Checkpoint Writer

Status: completed
Last updated: 2026-05-08T19:01:01Z

## Goal

Remove the Cloudflare bridge's foreground working-commit writer path so hosted workspace checkpoint snapshot construction is structurally idle-shutdown only.

Success criteria:

- `createHostedWorkspaceBridgeCheckpointSnapshot` rejects every checkpoint reason except `idle_shutdown`.
- Cloudflare bridge code no longer imports or calls the working-delta snapshot writer.
- Working-delta writer diagnostics and writer-only metrics are removed from the bridge.
- Restore and idle compaction still tolerate legacy working and layered refs.
- Tests and durable docs reflect idle-only checkpoint writing.

## Constraints

- Preserve unrelated dirty worktree edits.
- Keep restore compatibility for legacy working refs.
- Do not broaden checkpoint architecture or add replacement foreground writers.
- Avoid exposing local usernames, home paths, secrets, or direct personal identifiers.

## Implementation Notes

- Prefer deletion over compatibility shims.
- Keep runtime-state working-delta primitives intact because restore/tests outside the Cloudflare writer may still exercise legacy refs.
- Use focused Cloudflare verification first; escalate according to repo verification rules.
- Production bridge snapshot construction is idle-shutdown only. Legacy working `{base, delta}` construction remains only in an explicit test fixture helper for restore/compaction coverage.

## Verification

- PASS: `vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts --no-coverage` (15 tests).
- PASS: `vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts --no-coverage` (1 test).
- PASS: `pnpm --dir apps/cloudflare typecheck`.
- PASS: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/operations/verification-and-runtime.md agent-docs/index.md` (apps/cloudflare verify: 70 files, 901 tests).
- PASS: `pnpm docs:drift`.
- PASS: `git diff --check`.
- AUDIT: simplify review found two low-severity cleanup leftovers; both were applied.
- AUDIT: security/privacy review found no scoped findings.
- AUDIT: coverage review found coverage sufficient and made no edits.
Updated: 2026-05-09
Completed: 2026-05-09
