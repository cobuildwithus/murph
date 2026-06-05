# Connect Intent Recovery Dialog

## Goal

Show a brief recovery dialog when a hosted device-connect intent is unavailable after auth, especially `HOSTED_DEVICE_CONNECT_INTENT_MISSING` / 410 responses from `/device/connect/:claim`.

Success criteria:

- A failed initial intent redemption with a `HOSTED_DEVICE_CONNECT_INTENT_*` error opens a concise dialog instead of only surfacing card-level error text.
- The dialog includes a primary action to contact Murph for a fresh link.
- The client still does not pre-validate or redeem claims before auth.
- Server-side claim owner, expiry, provider, and target validation remain unchanged.

## Constraints

- Keep device-connect recovery behavior in the connect page, not in the generic auth dialog.
- Do not print real device-connect claims or provider secrets in logs/docs/tests.
- Preserve unrelated worktree edits if any appear.

## Working Set

- `apps/web/app/(dashboard)/connect/connect-page-client.tsx`
- `apps/web/app/(dashboard)/connect/page.tsx`
- `apps/web/test/connect-page.test.ts`
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
