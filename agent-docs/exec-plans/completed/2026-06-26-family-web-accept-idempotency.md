Goal (incl. success criteria):
- Make web Family invite acceptance retry-safe after a successful accept response is lost.
- Success means the API route lets already-accepted invites reach domain idempotency while still rejecting expired/revoked invites before mutation.

Constraints/Assumptions:
- Keep this route-scoped; `acceptHostedFamilyInviteTx` remains the authoritative same-member idempotency guard.
- Do not expose accepted member ids in the public invite acceptance view.
- Preserve existing checks for inactive groups, full seats, and non-web-bound pending invites.

Key decisions:
- Treat `accepted` as a potentially idempotent POST state and defer final authorization to the domain accept function.
- Continue rejecting expired and revoked statuses immediately.

State:
- In progress.

Done:
- Found the route blocked `accepted` before the domain idempotency path could run.

Now:
- Patch the accept route and add focused regression coverage.

Next:
- Run route tests and typecheck before a scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/api/family/invites/[inviteCode]/accept/route.ts
- apps/web/test/family-invite-accept-route.test.ts
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
