## Goal

Fail closed on hosted-email public-sender callback infrastructure errors while preserving accept-and-drop behavior for explicit authorization misses.

## Why

- The current public-sender route lookup collapses callback throws and non-OK HTTP responses into the same `null` outcome as a real direct-public auth miss.
- `handleHostedEmailIngress` then treats that `null` as an accept-and-drop for the fixed public sender address, so legitimate mail is silently lost during callback outages or config/signing breakage.
- Repo security policy only allows accept-and-drop for public-sender misses or failed owner authorization, not for callback infrastructure failure.

## Scope

- `apps/cloudflare/src/hosted-email/routes.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/hosted-email.ts` only if the route error/result surface needs re-exporting
- focused `apps/cloudflare/test/{hosted-email,hosted-email-worker-ingress}.test.ts`

## Constraints

- Preserve the current accept-and-drop behavior for explicit public-sender misses.
- Preserve the current reject-on-failure behavior for non-public alias ingress.
- Do not change the web callback contract; distinguish outcomes from its existing `200` negative payloads vs thrown/non-OK failures.
- Avoid unrelated Cloudflare/runtime edits already in flight in the same worktree.

## Planned shape

1. Give public-sender route lookup an explicit failure path for callback transport/config/non-OK failures.
2. Treat only explicit negative auth outcomes as a clean `null` route.
3. Let worker ingress propagate infra failures instead of early-returning like a miss.
4. Add tests for clean miss, thrown callback, and `503` callback outcomes.

## Verification target

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/hosted-email/routes.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/src/hosted-email.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts`

## Notes

- `apps/cloudflare/test/hosted-email-worker-ingress.test.ts` already has adjacent in-flight edits in this worktree. Merge carefully and keep this lane limited to hosted-email ingress behavior.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
