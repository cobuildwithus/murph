# PR 344 Legacy Null Container Name

## Goal

Fix ReviewGPT round 16: a null persisted active-fence container name must resolve to the legacy unversioned per-user container, not the current versioned fresh-start container.

## Constraints

- Keep fresh starts on the current versioned resolver.
- Keep persisted non-null container names identity-checked as before.
- No new state, route, queue, scheduler, or lifecycle owner.

## Approach

- Narrow `readActiveRuntimeRunnerContainerName` so null active-fence names return the legacy `userId` container name.
- Add a versioned-env UserRunner regression proving retention preemption checks the unversioned legacy container and does not derive inactive proof from the current versioned container.

## Verification

- Focused UserRunner tests.
- Focused RunnerContainer/runtime transport tests.
- Cloudflare typecheck.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
