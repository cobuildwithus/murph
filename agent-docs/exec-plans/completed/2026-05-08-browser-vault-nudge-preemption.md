# Browser Vault Nudge Preemption

## Goal

Make pending nudge preemption explicit at the browser-vault refresh start boundary.

## Scope

- Guard detached browser-vault refresh start on durable `pendingNudge` and `inFlight` state.
- Preserve pending refresh scheduling so the optional refresh can run later when user work is quiet.
- Add focused Cloudflare runner tests for pending-nudge and nudge-during-refresh cases.

## Constraints

- Browser-vault refresh stays optional/background and must not block foreground runner work.
- Nudge work wins over browser-vault refresh.
- Do not expose secrets, account identifiers, local paths, or raw request bodies in tests or docs.

## Verification

- Focused `apps/cloudflare` runner test for `user-runner-alarm`.
- Typecheck or diff-scoped verification if practical in the dirty worktree.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
