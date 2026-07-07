# Device-connect completion dialog: retry-once on unverified fallback + page-auth anonymous-downgrade logging

Date: 2026-07-07
Owner: Claude (supervisor) / Codex (implementation)
Worktree: `/private/tmp/murph-device-completion-retry`, branch `fix/device-completion-unverified-retry`

## Why (incident)

2026-07-07 02:58 UTC: a member connected Oura via a texted claim link. The OAuth
callback succeeded and every server-side fact needed for the celebratory dialog
existed in the DB seconds before render (active junction connection, confirmed
oura upstream source, Linq routing phone, `deviceSyncStatus=connected` in the
URL). She still saw the generic fallback ("Device connection complete" / "Open
Murph to confirm your connected sources.") with no "Text Murph" CTA because the
`/home` render resolved no member. Two mechanisms can cause that even for a
signed-in user:

1. The cross-site return navigation (Junction/Oura → callback → /home) not
   presenting the session cookie on that one request (she signed in mid-flow,
   30s earlier, iOS Safari).
2. `getHostedAppSessionForPublicPageAuth` silently treating a transient
   session-store (Prisma unavailable) error as "anonymous" with zero logging
   (`apps/web/src/lib/hosted-onboarding/page-auth.ts`).

Both self-heal on a second same-site request, so the fix is a single automatic
`router.refresh()` retry, not a new auth surface. Today a manual refresh cannot
recover the moment because the dialog strips the completion query params on
mount.

## Change

1. **Model flag.** Add `unverified: boolean` to `DeviceSyncCompletionDialogModel`
   (`apps/web/src/lib/device-sync/connect-completion-types.ts`), documented as:
   the URL asserted a successful connect but the server could not verify it
   (no member session, no matching active source, or a transient load error).
   - `apps/web/src/lib/device-sync/connect-completion.ts`: set
     `unverified: !failed && callback.status === "connected" && !connected`.
     This is exactly the states that currently produce the generic fallback
     despite a success-asserting URL (member null, connectedSource null,
     loadError). Replay-stripped URLs (`status` absent) and error callbacks stay
     `unverified: false` — a refresh cannot improve them.
   - `apps/web/src/lib/connected-apps/connect-completion.ts`: set
     `unverified: false` on both returns (that resolver does no server-side
     verification, so there is no unverified state).

2. **Client retry-once.**
   `apps/web/app/(dashboard)/home/device-sync-completion-dialog.tsx`:
   - When `model.unverified` and no retry has happened yet: do NOT strip the
     completion query params; trigger one `router.refresh()`
     (`useRouter` from `next/navigation`). The refreshed server render re-runs
     `resolveDeviceSyncCompletionDialogModel` with the same params and the
     dialog upgrades in place to the verified copy + contact CTA.
   - When the model is verified/failed, or after the one retry: strip params as
     today.
   - The retry guard MUST be provably loop-proof even if the component
     remounts. A module-scope boolean (reset only by a full page load, which is
     itself a fresh verification pass) is acceptable and simplest; a `useRef`
     is fine only with evidence Next preserves client state across
     `router.refresh()` in our setup.
   - Add `data-completion-unverified` (or similar) on the dialog content when
     unverified so page-level markup tests can assert the flag end-to-end.
   - Keep the `COMPLETION_QUERY_KEYS` sync comment accurate.

3. **Observability.** In `getHostedAppSessionForPublicPageAuth`
   (`apps/web/src/lib/hosted-onboarding/page-auth.ts`), before returning null on
   a store-unavailable error, emit one secret-safe `console.warn` including only
   the error code/name (no tokens, no cookie values). Today this auth downgrade
   is invisible.

## Tests

Extend `apps/web/test/device-sync-connect-complete-page.test.ts`:
- Unverified marker present for: no-member fallback; connected-status-but-no-
  matching-active-source; settings-load-throw.
- Marker absent for: verified connected (with and without contact action),
  callback error, missing status (replay-stripped), and connected-app dialogs.
- Existing assertions unchanged.
Client retry behavior: add a focused test only if the repo already has a
jsdom/client-component test harness pattern for `apps/web`; do not invent a new
harness for this.

## Invariants

- No behavior change for verified, failed, replay-stripped, or connected-app
  dialogs beyond the added inert flag.
- At most one automatic refresh per page load under all remount orders.
- No new auth surface, persisted state, or query params.
- Log line must be secret-safe (error code/name only).

## Verification

- `pnpm test:diff <touched paths>` if truthful for apps/web; otherwise the
  apps/web vitest config-scoped run for the touched test file(s) plus
  `pnpm typecheck` (apps/web vitest requires an explicit `--config`).
- Audits (per workflow routing): `security-privacy-review` (session/auth
  logging), `frontend-review` (user-facing apps/web UI), `coverage-write`.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
