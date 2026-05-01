Goal (incl. success criteria):
- Add privacy-safe production diagnostics for hosted assistant WHOOP/device connect-link failures.
- Success means prod logs can distinguish runtime helper availability, helper start/success/failure, and web route auth/body/control-plane stages without logging OAuth URLs, state, signatures, tokens, raw headers, or secrets.

Constraints/Assumptions:
- Preserve unrelated dirty assistant/parser/Health Commons/hosted rows in the current checkout.
- Do not log connect authorization URLs, OAuth state, callback signatures, raw request bodies, provider secrets, tokens, or personal identifiers.
- Treat provider ids, enum return targets, counts, booleans, status codes, and bounded error codes as acceptable diagnostics.
- Root `pnpm typecheck` may still be blocked by unrelated active work; use focused checks if the pre-existing blocker remains.

Key decisions:
- Use the existing hosted runtime durable log port for assistant-phase connect diagnostics.
- Use the existing hosted-web route error mapper/console diagnostics for internal route stage failures instead of adding a new logging transport.

State:
- Completed; safe scoped commit is blocked by overlapping dirty hunks in shared hosted-execution/ledger files.

Done:
- Previous root-cause work fixed hosted-local E2E key-id fixture determinism but did not prove the production proxy path.
- Added assistant durable `assistant.device_connect` diagnostics for context availability and helper requested/issued/failed stages.
- Added internal hosted-web connect-link route diagnostics for callback verification, route param, request body, messaging return target, and control-plane stages.
- Bounded diagnostics to provider allowlist values, parser-safe return-target keys, enum stages/statuses, booleans, counts, status codes, and bounded error codes.
- Added regression proof that OAuth URLs, OAuth state, provider secrets, unsafe providers, and unsafe error-code values are not emitted by the new diagnostics.
- Security/privacy review and final review findings were fixed; coverage-write found no missing proof.

Now:
- Closing plan after verification.

Next:
- Deploy/read prod logs for `assistant.device_connect` and `Hosted internal device-sync connect-link diagnostic.` records around the failing WHOOP request.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether the current production failure is helper absence, web-control transport failure, callback verification rejection, or provider/control-plane setup failure.
- UNCONFIRMED: Production Cloudflare/web logs for the original failing request have not been inspected from this local session.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts`
- `apps/web/test/device-sync-internal-connect-route.test.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- Verification passed: focused assistant-runtime test, hosted-execution runtime-control test, focused hosted-web connect route test, package/app typechecks, root `pnpm typecheck`, diff-aware `pnpm test:diff ...`, and `pnpm --dir apps/cloudflare test:e2e:device-connect:local`.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
