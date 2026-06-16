Goal (incl. success criteria):
- Fix Junction-backed WHOOP source errors so the website no longer shows the source as connected/green when Junction reports a reconnect-required token refresh failure.
- Add a manual operator CLI path to create a source-specific reconnect link; no automatic outreach or background reconnect attempts.

Constraints/Assumptions:
- Keep the parent Junction account active when only a nested source is broken.
- Use existing `device_connection_source` error fields as product truth; do not add new persisted state or source-health services.
- Reconnect link creation must use the existing hosted device connect intent and normal Junction Link flow.
- Avoid exposing member identifiers or credentials in code, docs, logs, or command examples.

Key decisions:
- Treat Junction source `TOKEN_REFRESH_FAILED` as a source-level reconnect-needed state in settings/connect surfaces.
- Keep the fix local to projection/UI and a thin operator script.

State:
- Implementation complete; final commit/PR in progress.

Done:
- Static analysis confirmed Junction source errors are already stored on `device_connection_source.lastErrorCode`.
- Browser source projection now exposes a boolean reconnect-needed flag instead of raw provider error codes.
- Settings/connect surfaces treat Junction source reconnect flags as source-level attention/reconnect state while leaving the parent Junction account active.
- Added a manual hosted-web operator command for creating source-specific reconnect links.
- Focused tests, full hosted-web tests, lint, diff check, and CLI help command were run.

Now:
- Commit through `scripts/finish-task` and open the PR.

Next:
- Push branch and create PR.

Open questions (UNCONFIRMED if needed):
- `pnpm --dir apps/web typecheck` is blocked by pre-existing `app/api/internal/device-sync/junction/workouts/raw/route.ts` import resolution for `@murphai/device-syncd/providers/junction-client`.

Working set (files/ids/commands):
- `apps/web/src/lib/device-sync/public-ingress-service.ts`
- `apps/web/src/lib/device-sync/settings-surface.ts`
- `apps/web/app/(dashboard)/connect/page.tsx`
- `apps/web/scripts/*`
- Relevant `apps/web/test/*`
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
