# Hosted Idle-Only Checkpoint Writer

Status: active
Last updated: 2026-05-08T18:42:12Z

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

## Verification

Pending.
