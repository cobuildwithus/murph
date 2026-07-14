# Linq live route authority simplification

## Goal

Restore Linq replies by making the authenticated member's current durable
thread route the only authority for thread egress. Remove stale runner-carried
proof from the authorization decision without weakening cross-member or
suspended-member isolation.

## Success criteria

- A thread send is allowed when the requested Linq thread currently belongs to
  the authenticated runtime member and that member has active access.
- The same send is rejected for another member's route or inactive access.
- Stale, missing, or mismatched runner `routeAuthority` / `currentInbound`
  payloads cannot override the live database owner.
- Focused tests, typecheck, required audits, production deploy, and a post-deploy
  log check complete successfully.

## Constraints

- Delete duplicate proof requirements; add no state, service, dependency,
  queue, migration, or fallback branch.
- Preserve participant first-contact and home-route authorization.
- Keep logs, commits, and docs free of credentials and private identifiers.

## Approach

1. Resolve the target's current durable thread route under the existing target
   ownership lock.
2. Allow only an active route owned by the authenticated member, independent
   of copied runner proof.
3. Retain existing checks for participant sends and targets with no durable
   thread route.
4. Add focused allow/deny regression tests, run verification and audits, then
   commit, push `main`, deploy, and verify production errors stop.

## State

Completed.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
