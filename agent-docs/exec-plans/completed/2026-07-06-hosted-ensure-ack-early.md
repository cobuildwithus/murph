# Hosted Ensure Ack-Early

## Goal

Make the web direct `ensure-processing` wake acknowledge immediately after auth
and request parsing, while keeping Temporal callback-signed ensure requests
synchronous and response-compatible.

Success criteria:

- Vercel OIDC direct wake receives `202 { accepted: true }`.
- The existing Durable Object `ensureRuntimeProcessingForUser` call still runs
  identically for the direct wake, but under Worker `ctx.waitUntil`.
- Callback-signed Temporal ensure requests return the existing full result
  synchronously.
- The hosted-control client tolerates both old full-result responses and the new
  direct-wake ack, and still emits timing callbacks.
- Web direct-control keep-alive windows are widened to cover the observed
  1-5 minute conversation gaps without adding new state or routing.

## Context

Measured post-PR-404 traces showed reused direct-ensure connection arrivals at
12-255 ms versus roughly 600-850 ms after the current 60 second undici idle
window expires. The long tail was on the response leg because the Worker route
awaited Durable Object wake/reconstruction before returning even though the web
caller is fire-and-forget and ignores the response body.

Cloudflare Worker `ctx.waitUntil` is the minimal platform primitive for this:
it keeps post-response work alive after the response or client disconnect, with
the documented post-response extension window covering the observed worst case.

## Constraints

- No new headers, flags, environment variables, routes, durable state, or
  production harness bypasses.
- Dispatch only on the existing presented auth kind:
  `vercel-oidc` versus `web-callback-signature`.
- Do not touch `ensureRuntimeProcessingForUser` or its diagnostics payload.
- WaitUntil-path failures must use the existing structured logging helper and
  must not become unhandled promise rejections.
- Temporal backstop behavior and callback-signed response shape stay unchanged.

## Semantic Note

After this change, the web direct wake RTT metric recorded by the hosted-control
client for Vercel OIDC direct wake measures request arrival plus auth/parse/ack,
not Durable Object wake completion. The client remains response-shape tolerant
for deploy skew: old Cloudflare returns the full result, new Cloudflare returns
the ack.

## Verification Plan

- Verify the Vercel OIDC caller matrix before code changes:
  web direct wake path, Temporal callback-signed path, and local harness/smoke
  credentials/body assertions.
- Add Cloudflare route tests for Vercel OIDC ack + captured waitUntil, callback
  signature full synchronous result, and waitUntil rejection logging.
- Add hosted-control client tests for `202` ack acceptance, timing callback, and
  old full-result compatibility.
- Run focused typechecks for `apps/cloudflare`, `apps/web`, and
  `packages/cloudflare-hosted-control`.
- Run focused touched-owner test suites for the route, client, and webhook wake.

## State

Done:

- Verified the Vercel OIDC ensure caller is the web direct wake path through
  `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts` and
  `packages/cloudflare-hosted-control/src/client.ts`; it is best-effort and
  does not use the response body for correctness.
- Verified the Temporal worker uses the callback-signature HTTP client path and
  still parses the full synchronous ensure result.
- Verified `apps/cloudflare/test/helpers/hosted-local-wake.ts` uses callback
  signatures and parses the full result, so harness synchronous behavior stays
  on that credential path.
- Threaded the Worker execution context through the Worker fetch entrypoints
  into `WorkerRouteContext`.
- Vercel OIDC direct ensure now returns `202 { accepted: true }` after auth and
  parse, while scheduling the existing Durable Object ensure call under
  `ctx.waitUntil` with structured failure logging.
- Callback-signature ensure requests retain the old synchronous response path.
- The hosted-control client accepts both the old full result and the new ack
  shape while still emitting timing.
- Web direct-control keep-alive windows are now 300s/600s with the measured
  direct-wake RTT rationale in code.
- Verification passed:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/cloudflare-hosted-control typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/client.test.ts` from `packages/cloudflare-hosted-control`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-webhook-wake-direct-ensure.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-wake.test.ts`

Now: final diff inspection and scoped commit.

Next: no runner bundle rebuild; hand off with deployment note that web and
Cloudflare can deploy in either order because the request shape is unchanged
and the new web client accepts both response shapes.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
