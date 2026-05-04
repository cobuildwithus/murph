# Cloudflare Runner Stub Cache

## Goal

Stop hosted runner artifact writes from reusing request-scoped Durable Object RPC stubs across Cloudflare requests, so artifact lease checks can run without `OutgoingFactory` cross-request failures and mailbox lag can drain after accepted runner nudges.

## Constraints

- Keep the worker-side artifact lease check fail-closed before artifact crypto or R2 writes.
- Do not widen the runner outbound proxy surface or log user/message payloads.
- Preserve the short-lived crypto-context single-flight behavior only for plaintext-free pending loads.
- Keep the change scoped to the Cloudflare runner outbound path and focused regressions.

## State

Done:
- Verified hosted web/Vercel accepted inbound messages and runner nudges.
- Verified DB mailbox high-water rows are ahead of hosted workspace imported watermarks.
- Verified Cloudflare Worker logs show repeated artifact `PUT` failures in `artifactWriteRequestOwnsActiveInvocationLease` with `OutgoingFactory` cross-request I/O errors.
- Found a remaining module-level bind-user cache for user-runner Durable Object RPC stubs.
- Removed user-runner Durable Object RPC stub caching while preserving crypto-context pending single-flight.
- Updated runner outbound tests to prove accepted artifact `PUT` requests resolve fresh bound stubs.
- Passed focused runner outbound tests, `pnpm test:diff` for the Cloudflare slice, `pnpm typecheck`, and `git diff --check`.
- Completion audits passed with no required code changes.

Now:
- Close the plan and create the scoped commit.

Next:
- Deploy the commit to Cloudflare and watch for absence of artifact `PUT` `OutgoingFactory` failures.

## Working Set

- `apps/cloudflare/src/runner-outbound/shared.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
