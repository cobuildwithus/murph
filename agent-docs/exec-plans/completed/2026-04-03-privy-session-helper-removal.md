# Privy hosted-session helper removal

## Goal

Remove the legacy hosted-session compatibility helpers from `apps/web` now that the hosted onboarding, share, billing, and settings flows authenticate through Privy bearer plus identity-token headers instead of the Murph-specific `hosted_session` cookie.

## Scope

- Delete the unused hosted-session helper module and dead logout route.
- Remove compatibility-only `sessionRecord` and cookie-store fallbacks from hosted billing/share auth helpers.
- Strip the now-unused hosted-session env/docs/test scaffolding that only existed to support the removed helper surface.

## Non-goals

- No database migration or Prisma schema hard-cut in this task.
- No new auth-flow redesign beyond removing the already-dead compatibility layer.
- No changes outside the hosted onboarding/share/settings surface in `apps/web`.

## Verification

- Run focused `apps/web` tests for the touched hosted onboarding/share paths first.
- Then run the repo-required verification commands for `apps/web` changes and record any unrelated baseline failures explicitly.

## Notes

- Treat the live tree as source of truth; the earlier Privy refactor patch is not present as a clean local diff in the current worktree.
- Preserve unrelated dirty-tree work and keep the cleanup limited to helpers that no live hosted flow still calls.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
