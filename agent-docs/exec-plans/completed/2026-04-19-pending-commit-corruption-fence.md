## Title

Fail closed when DO-local `pending_commit_json` is present but malformed for the bound hosted runner user.

## Goal

Preserve replay and overwrite fencing for Cloudflare hosted wakes by treating a present-but-unreadable `pending_commit_json` record as corruption that blocks wake replay and pending-commit replacement until the runner state is repaired.

## Scope

- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- focused Cloudflare runner-state and hosted-runner corruption tests proving the corruption case

## Constraints

- Keep the fix narrow and local to the DO pending-commit seam.
- Do not weaken the existing user binding; corruption must still fail closed for the bound user only.
- Preserve the current stateless-executor architecture where `pending_commit_json` is the only DO-local pre-CAS recovery seam.
- Avoid unrelated wake lifecycle, cursor, or bundle-cache behavior changes.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/runner-state-store.test.ts apps/cloudflare/test/runner-pending-commit-corruption.test.ts`

## Notes

- The required proof is explicit: seed invalid `pending_commit_json`, show the old path treated it as absent, and keep the new path fail-closed for both `readPendingCommit(...)`-driven replay and `writePendingCommit(...)` overwrite attempts.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
