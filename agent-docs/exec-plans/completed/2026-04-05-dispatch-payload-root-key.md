# Dispatch Payload Root Key

## Goal

Move hosted dispatch payload transient blob storage off the worker-wide bundle key and onto the per-user root key once the owning `userId` is known inside the per-user runner.

## Scope

- Change the `HostedUserRunner` dispatch-payload store wiring so new pending payload blobs are encrypted with the bound user's root key.
- Hard-cut the runner path so it no longer depends on the worker-wide bundle key for dispatch payload blob reads or writes.
- Update focused Cloudflare tests that prove the new per-user-root-key path and the hard cut away from worker-key decryptability.

## Constraints

- Treat this as a high-risk hosted privacy/storage change.
- Preserve unrelated dirty-tree edits already present in hosted Cloudflare files.
- Keep the change narrow to dispatch payload blobs; do not broaden into hosted raw email or other storage paths in this turn.
- Treat this as greenfield-only per the user's latest direction; do not add or preserve a worker-key compatibility lane just for old dispatch payload blobs.

## Verification

- Focused Cloudflare tests for dispatch payload confidentiality and runner queue/root-key behavior.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
