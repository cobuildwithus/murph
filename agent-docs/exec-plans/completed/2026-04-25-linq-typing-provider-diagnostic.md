Goal (incl. success criteria):
- Add a gated hosted-web production diagnostic that sends a controlled Linq typing-only burst to the latest routed Linq chat so we can distinguish Linq/iMessage display behavior from cold-start timing.
- Success: the route requires internal auth, does not accept or log raw chat ids, returns only sanitized attempt timings/statuses, and has focused route/client tests.

Constraints/Assumptions:
- Preserve active Cloudflare/runtime hosted typing rows; do not touch runner/container typing ownership unless the diagnostic proves it necessary.
- Use existing hosted member routing decryption and existing Vercel cron bearer auth.
- Do not expose member ids, phone numbers, chat ids, message bodies, raw payloads, tokens, or local paths in logs/docs/responses.

Key decisions:
- Target defaults to the most recent hosted Linq conversation ingress event and resolves its current home or pending Linq route server-side.
- Reuse the existing hosted Linq ingress diagnostic flag as the enable switch for the internal route.

State:
- in_progress

Done:
- Reviewed existing Linq typing ingress diagnostic and hosted member routing encryption/projection code.
- Added the internal hosted-web Linq typing diagnostic route, service, DELETE typing-stop helper, and focused route/service tests.
- Verified focused hosted-web tests and hosted-web typecheck pass.
- Attempted the existing local Cloudflare Linq delivery E2E; it was blocked before the test by unrelated Health Commons TypeScript build errors in active work.

Now:
- Handoff the production diagnostic route and next production test command.

Next:
- After deploy, call the diagnostic route while watching the iMessage thread and tail Vercel/Linq diagnostic logs.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Linq HTTP 204 guarantees iMessage clients visibly render typing.

Working set (files/ids/commands):
- `apps/web/app/api/internal/hosted-onboarding/linq/typing-diagnostic/route.ts`
- `apps/web/src/lib/hosted-onboarding/linq-typing-diagnostic.ts`
- `apps/web/src/lib/hosted-onboarding/linq-client.ts`
- `apps/web/test/hosted-onboarding-linq-typing-diagnostic-route.test.ts`
- `apps/web/test/hosted-onboarding-linq-typing-diagnostic.test.ts`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
