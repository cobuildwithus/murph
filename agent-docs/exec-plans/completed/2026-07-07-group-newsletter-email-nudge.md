# Group Newsletter Email Nudge

## Goal

Members who grant `group-email.v0` while joining a hosted group, but do not yet
have a verified email, get the existing private `group-newsletter.email-needed`
mailbox nudge automatically.

## Constraints

- Reuse the current newsletter missing-email mailbox item and dedupe key.
- Do not add a scheduler, queue, table, dynamic-tool action, or direct provider
  send path.
- Only nudge members who have actually granted `group-email.v0` to the group.
- Keep the nudge private to the joining member's own Murph runtime.
- Preserve decline behavior: if email sharing is not granted, no nudge.

## Plan

1. Extract the existing newsletter missing-email enqueue path into a reusable
   permission/email/route-gated helper.
2. Return post-commit nudge candidates from group creation, join-code
   acceptance, and join-offer acceptance when `group-email.v0` is granted.
3. Invoke the helper after the transaction commits in each group entry point.
4. Add focused coverage for the helper and both join entry points.
5. Run focused tests, app-scoped verification, final diff review, commit, open a
   PR, and run the required PR deep-review loop to zero accepted findings.

## Verification

- Focused hosted group newsletter/join tests.
- `pnpm typecheck`.
- `pnpm test:diff` for touched `apps/web` paths when the diff-aware lane covers
  the slice truthfully.

## State

Active.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
