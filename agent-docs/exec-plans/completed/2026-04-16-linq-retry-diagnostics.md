Goal (incl. success criteria):
- Make the local hosted Linq first-contact e2e mirror production `linq-materialize-home-thread` activation closely enough to prove the real activation welcome path works before prod deploys.
- Success means the prod-shaped local activation sends a Linq `POST /chats` welcome, later inbound Linq messages reply on the created chat, and the harness fails when the production path regresses.

Constraints/Assumptions:
- Keep the fix narrow to the Linq first-contact welcome path and its tests.
- Do not change Telegram/iMessage identity semantics.
- Preserve unrelated worktree edits.

Key decisions:
- Treat the prod-shaped local e2e failure as a real production-path mismatch rather than loosening the test back to the older thread shortcut.
- Keep generic assistant session resolution conversation-oriented and move the Linq home-thread special case into the first-contact outbound delivery route only.
- Keep the local harness on the production-style `linq-materialize-home-thread` activation shape.
- Make the local Linq stub return opaque chat ids so the e2e proves the runtime persists and reuses the provider-returned chat id.

State:
- completed

Done:
- Verified the old local e2e was green only because it used a direct thread shortcut instead of the production activation shape.
- Switched the local e2e to production-style `linq-materialize-home-thread` activation and confirmed it currently completes with zero Linq traffic.
- Identified the missing participant delivery binding in the first-contact welcome session-resolution path as the likely cause.
- Simplified `first-contact-welcome-delivery.ts` so first-contact computes one explicit Linq delivery override instead of teaching generic session resolution about provider-specific materialization.
- Strengthened assistant-engine seam coverage to prove the queued first-contact path overrides the resolved session binding with an explicit participant route.
- Strengthened the hosted local Linq e2e so activation waits are user-specific and reply delivery uses the actual opaque chat id returned by the stubbed `/chats` materialization call.
- Verified with:
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-product-small-seams.test.ts --no-coverage`
  - `pnpm exec vitest run --hookTimeout=600000 --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage`
  - `pnpm test:diff packages/assistant-engine/src/assistant/first-contact-welcome-delivery.ts packages/assistant-engine/test/assistant-product-small-seams.test.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`

Now:
- Close out the scoped lane and hand off the architecture recommendation plus the unrelated workspace `pnpm typecheck` failure details.

Next:
- If desired later, extract the first-contact delivery override into a tiny dedicated adapter only if another provider ever needs the same “materialize thread on first send” behavior.

Open questions (UNCONFIRMED if needed):
- None for this lane.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/first-contact-welcome-delivery.ts`
- `packages/assistant-engine/test/assistant-product-small-seams.test.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `pnpm exec vitest run packages/assistant-engine/test/assistant-product-small-seams.test.ts --no-coverage`
- `pnpm exec vitest run --hookTimeout=600000 --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage`
- `pnpm test:diff packages/assistant-engine/src/assistant/first-contact-welcome-delivery.ts packages/assistant-engine/test/assistant-product-small-seams.test.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
