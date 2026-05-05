# Hosted checkpoint replica guard relax

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Stop hosted assistant runner checkpoints from failing solely because a non-empty workspace snapshot is missing a browser-vault replica ref.
- Preserve the stronger guard that rejects a mismatched browser-vault replica ref when one is supplied.
- Prove the relaxed checkpoint path with focused store and internal-route compatibility coverage.
- Document assistant liveness as stronger than optional browser-vault/dashboard sidecar freshness.

## Scope

- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts`
- `apps/web/test/hosted-runtime-internal-routes.test.ts`
- `apps/web/test/hosted-workspace-store.test.ts`
- `agent-docs/references/hosted-runtime-protocol.md`

## Notes

- Production evidence showed conversation mailbox ingress succeeded while runner retries failed at `POST /api/internal/hosted-workspace/checkpoint` with HTTP 400 before mailbox import/reply start.
- This fix treats browser-vault replica generation as recoverable auxiliary state rather than a hard prerequisite for assistant runtime checkpoint durability.
- Old deployed runner payloads may omit `browserVaultReplicaRef`; new optional checkpoint fields must use the same compatibility shape unless an explicit version/capability rollout makes them safe to require.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-workspace-store.test.ts test/hosted-runtime-internal-routes.test.ts --no-coverage` passed.
- Security/privacy review found that old runner payloads omitting
  `browserVaultReplicaRef` could leave a stale prior replica ref after the
  snapshot advanced; fixed by clearing the stored sidecar ref on omitted
  continuity and added store regression coverage.
- Post-fix review found no remaining issues in the stale-ref clear path.
- `pnpm typecheck` is blocked by unrelated active hosted-web device-sync dirty
  ack work in `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`:
  the returned object is missing `nextWakeAt` and `stillDirty` for
  `HostedExecutionDeviceSyncDirtyAckResponse`.
Completed: 2026-05-05
