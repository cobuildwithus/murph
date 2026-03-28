# Cloudflare production hardening

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Close the remaining hosted Cloudflare production-readiness gaps without changing the core Durable Object + native Container + encrypted workspace-snapshot architecture.

## Scope

- selective hosted artifact hydration during runner restore so the one-shot runtime stops eagerly fetching every externalized artifact
- per-user bundle/artifact cleanup after successful bundle transitions so replaced snapshots and orphaned artifact objects do not accumulate indefinitely
- explicit single-key enforcement for encrypted hosted objects so key rotation is treated as unsupported until multi-key reads or a re-encryption migration exists
- truthful docs/tests for the new runtime behavior

## Non-goals

- changing the hosted control-plane or Cloudflare deployment architecture
- adding a hosted virtual filesystem abstraction
- inventing a migration path for preexisting hosted users from older bundle layouts; current repo guidance is that there are no real hosted users to preserve in this pass
- removing the existing legacy read tolerance unless it directly blocks the hardening work

## Files

- `packages/runtime-state/src/{hosted-bundle.ts,hosted-bundles.ts}`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/assistant-runtime/src/hosted-runtime{.ts,/artifacts.ts,/maintenance.ts}`
- `packages/assistant-runtime/test/*.test.ts` as needed for direct hosted restore/hydration proof
- `apps/cloudflare/src/{bundle-store.ts,crypto.ts,user-runner.ts,user-runner/runner-bundle-sync.ts,user-runner/runner-commit-recovery.ts}`
- `apps/cloudflare/test/{node-runner.test.ts,user-runner.test.ts,index.test.ts}` as needed
- truthful runtime/deploy docs touched by the behavior change

## Verification

- focused package/app tests while iterating
- required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- required completion-workflow audits after functional verification:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Notes

- Preserve adjacent hosted-runtime and Cloudflare dirty edits already in the tree.
- Keep artifact hydration selective but conservative: missing needed artifacts must remain a hard failure, not a silent skip.
- Cleanup must stay best-effort and only target per-user objects proven unreachable from the latest durable refs. In practice that means per-user artifact objects only for this pass, because bundle objects remain shared content-addressed ciphertext.
- Simplify audit findings applied:
  - stop deleting superseded shared bundle objects
  - thread the configured runtime key id through hosted email inbound route resolution
- Coverage audit added focused regression proof for recovered-commit artifact cleanup and non-fatal artifact-delete failures during commit/finalize cleanup.
- Required audit status:
  - `simplify`: completed
  - `test-coverage-audit`: completed
  - `task-finish-review`: attempted via spawned worker but blocked by the local Codex usage limit before a final message was produced
Completed: 2026-03-28
