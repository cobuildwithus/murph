Goal (incl. success criteria):
- Prove that a Murph Messages extension launched from a Linq `imessage_app` card can perform a Murph-account action whose authority originates from a current Privy-authenticated host-app session.
- Success means the host exchanges a Privy identity token for a narrow, revocable Messages credential; the extension submits a typed proof-poll choice without receiving or storing a Privy token; signed-out, expired, revoked, and cross-scope tokens fail closed; and the iOS target builds with extension-only API enforcement.

Constraints/Assumptions:
- Privy Swift 2.12.0 is not app-extension-safe and its private session storage is not a supported cross-target API; do not link it into the Messages extension or share its raw tokens.
- The message URL is capability-less and contains no member identity, credential, health fact, or other private state.
- Reuse the existing short-lived hosted session persistence without changing the Prisma schema, while cryptographically separating credential scopes by token prefix and route guard.
- The proof action is deliberately non-durable; it demonstrates authenticated account authority without creating false product truth or a poll persistence model.
- Avoid the active mailbox schema/migration lane and preserve unrelated work.

Key decisions:
- The containing app alone calls Privy. It enrolls a 24-hour derived credential and stores that credential in an explicitly addressed shared Keychain group.
- Existing device-agent endpoints accept only the existing agent token prefix; Messages endpoints accept only a distinct Messages token prefix.
- Re-check active member and consent state on each Messages action instead of treating issuance as permanent account authorization.
- Linq delivery remains an operator-run acceptance step for the spike; no Linq secret or provider send authority is added to the iOS bundle.

State:
- Complete and ready for the physical-device acceptance test.

Done:
- Verified Linq's app-card contract and Apple Messages extension lifecycle from primary documentation.
- Proved the Privy Swift binary references extension-unavailable APIs and does not support selecting a shared storage adapter/access group.
- Selected a host-mediated, scoped credential exchange that does not expose Privy credentials to the extension.
- Implemented the scoped enrollment, revocation, and proof-action routes without a schema change.
- Added prefix-separated authority, per-action access and consent checks, host/extension integration, Linq send tooling, and the device runbook.
- Passed 13 focused backend tests, 4,280 repository web tests, production build/typecheck, prepared dev smoke, 87 host-app tests, and 8 Messages-extension tests.
- Completed coverage, security/privacy, and final correctness reviews with no medium-or-higher findings.

Now:
- Close the plan and create scoped commits on both isolated task branches.

Next:
- Deploy the backend to the Debug origin, validate physical-device signing/shared Keychain access, then run local-insertion and Linq-originated card acceptance.

Open questions (UNCONFIRMED if needed):
- Linq support for a directly installed development build is inferred from its Team ID plus extension bundle ID contract and still requires the on-device acceptance test.

Working set (files/ids/commands):
- apps/web/app/api/device-sync/companion/imessage-mini-app/**
- apps/web/src/lib/imessage-mini-app/**
- apps/web/src/lib/hosted-agent-sessions.ts
- apps/web/src/lib/device-sync/prisma-store/agent-sessions.ts
- apps/web/test/imessage-mini-app*.test.ts
- ARCHITECTURE.md
- agent-docs/SECURITY.md
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
