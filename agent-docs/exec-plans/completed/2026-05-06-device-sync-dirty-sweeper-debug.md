Goal (incl. success criteria):
- Debug hosted device-sync dirty sweeper logs where web finds stale dirty users and Cloudflare accepts runner nudges, but dirty rows apparently remain stale.
- Success means explaining the root cause, landing the narrow fix if code is at fault, and proving dirty nudge/drain/ack behavior with focused tests.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially existing coordination-ledger additions.
- Do not expose user identifiers, secrets, raw health data, home paths, or local usernames in logs, docs, commits, or handoff.
- Hosted web remains the device-sync authority; Cloudflare remains execution-only.
- Treat this as runtime/trust-boundary and reliability work.

Key decisions:
- The accepted-nudge response needed to expose whether an idle Durable Object runner actually started an immediate drive, not just whether a retry alarm was scheduled.
- The runner-side immediate-drive behavior had already been added in `f3f458850`; this closeout records the follow-up web/control-plane observability and tests landed in `3ba490c04`.

State:
- completed

Done:
- Read required workflow/architecture/product/security/reliability docs.
- Located dirty sweeper and hosted dirty state/ack surfaces.
- Confirmed the ambiguous logs came from accepted runner nudges that did not expose immediate-drive state.
- Surfaced `immediateDriveStarted` through the Cloudflare nudge result, hosted web best-effort nudge result, dirty sweeper logs, and mailbox lag sweeper logs.
- Updated hosted web nudge-result tests and related mocks.
- Committed the follow-up as `3ba490c04` (`fix(hosted): surface immediate runner drive state`).

Now:
- Archived after scoped commit.

Next:
- None for this plan. Any remaining production dirty-row lag should start from the new `immediateDriveStarted` signal and open a fresh plan only if behavior, not observability, is still failing.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether production still has dirty-row lag after the immediate-drive fix plus follow-up observability reached the deployed runner.

Working set (files/ids/commands):
- `apps/web/src/lib/device-sync/dirty-sweeper.ts`
- `apps/web/src/lib/device-sync/prisma-store/dirty-connections.ts`
- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- Verification evidence:
  - `pnpm --dir apps/cloudflare test:node -- --run test/user-runner-alarm.test.ts test/run-hosted-local-e2e.test.ts test/hosted-local-snapshot-stress-e2e.test.ts` passed during closeout work for the adjacent hosted nudge/test changes.
  - Broader hosted-web/root checks were blocked by unrelated existing hosted-web UI test failures and raw-payload/typecheck guards, recorded in the commit handoff.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
