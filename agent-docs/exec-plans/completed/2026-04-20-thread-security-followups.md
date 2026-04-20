## Title

Land the actionable security follow-ups from the exported ChatGPT thread without broadening into unrelated auth or import-architecture changes.

## Goal

Tighten three live seams surfaced by the exported security review: hosted-run log requests should require the active run token and persist only sanitized operator messages, hosted email Cloudflare logs should stop emitting raw routing metadata, and the hosted runner smoke helper should stop printing transcript text into operator or CI logs.

## Scope

- `apps/web/app/api/internal/hosted-run/log/route.ts`
- `apps/web/src/lib/hosted-run/store.ts`
- `apps/web/test/hosted-run-store.test.ts`
- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/parsers/run-control.ts`
- `packages/hosted-execution/test/hosted-wake-parsers.test.ts`
- `apps/cloudflare/src/hosted-email/routes.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- focused hosted-email Cloudflare tests that assert the new log-detail shape
- `apps/cloudflare/scripts/runner-docker-smoke.ts`
- `apps/cloudflare/src/hosted-runner-smoke-child.ts`
- `apps/cloudflare/src/hosted-runner-smoke-contract.ts`
- focused hosted-runner smoke tests

## Constraints

- Keep this scoped to the explicit findings from the exported thread.
- Do not broaden into device-sync bearer redesign or public/core import-lock refactors unless local inspection shows an immediate safe fix is necessary.
- Preserve unrelated dirty-tree edits across `apps/web`, `apps/cloudflare`, and shared packages.
- Prefer redaction/sanitization and narrow contract tightening over structural rewrites.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/app/api/internal/hosted-run/log/route.ts apps/web/src/lib/hosted-run/store.ts apps/web/test/hosted-run-store.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers/run-control.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts apps/cloudflare/src/hosted-email/routes.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/scripts/runner-docker-smoke.ts apps/cloudflare/src/hosted-runner-smoke-child.ts apps/cloudflare/src/hosted-runner-smoke-contract.ts apps/cloudflare/test/hosted-runner-smoke.test.ts apps/cloudflare/test/hosted-runner-smoke-contract.test.ts`
- planned: `git diff --check`

## Notes

- The exported thread contained prose findings only, with no patch attachment, so the implementation scope is derived from the final assistant response.
- The public `packages/core` import entrypoints already acquire the canonical input write lock before the internal append-plan helpers run; treat that reported issue as not yet reproduced locally unless a direct bypass appears during implementation.
- The device-sync bearer and refresh-token finding appears real but likely needs a wider protocol change than is safe for this turn; leave it as a reported follow-up unless a narrow change emerges from the local code.
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
