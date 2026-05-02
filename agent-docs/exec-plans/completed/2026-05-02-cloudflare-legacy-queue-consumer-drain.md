# Cloudflare Legacy Queue Consumer Drain

## Goal

Get the immediate Cloudflare hosted deploy past the retained remote runner wake Queue consumer without reintroducing Queue-based wake production.

Success criteria:

- Worker deploy succeeds while the live account still has the old runner wake Queue consumer attached.
- The repo still renders no Queue producer or consumer config.
- Any legacy Queue messages are routed through the current Durable Object nudge path instead of being silently acknowledged.
- Focused Cloudflare tests, typecheck/diff verification, CI, and deploy pass.

## Constraints / Assumptions

- Preserve unrelated dirty work, especially generated `apps/web/next-env.d.ts`.
- Do not print or commit secrets, private JWKs, `.env`, `.env.local`, or `.dev.vars` contents.
- The normal hosted runner trigger remains direct Durable Object nudge plus Durable Object alarm recovery.
- The local Cloudflare token can list queues but cannot remove the old consumer.

## Key Decisions

- Add a temporary legacy Queue consumer handler because the Cloudflare deploy API rejects scripts without a `queue()` handler while the old push consumer remains attached.
- Do not add Wrangler `queues` config or a Queue producer binding.
- Use `nudgeHostedRunner()` for valid legacy wake messages so behavior matches the current direct control-plane path.

## State

verified_pending_commit

## Done

- Confirmed the deploy-env bridge fixed the previous preflight failure.
- Confirmed the deploy now fails at Worker deploy with Cloudflare code `11001` for a missing Queue handler.
- Confirmed current repo config and tests intentionally omit `queues`.
- Confirmed Cloudflare docs require a default-export `queue()` handler for push Queue consumers.
- Confirmed the live account still has `murph-hosted-runner-wake` with an old consumer attached.
- Attempted consumer removal with local Wrangler credentials; removal is blocked by token permission.
- Added the narrow legacy Queue consumer shim, routing valid legacy messages through `nudgeHostedRunner()`.
- Added boundary tests for valid drain, nudge failure retry, invalid-message ack, and unexpected-queue retry.
- Passed focused Cloudflare route/deploy tests, Cloudflare typecheck, scoped `test:diff`, root typecheck, root test, coverage-write review, security/privacy review, and task-finish review.

## Now

- Close the active plan with a scoped commit.

## Next

- Push the scoped commit, wait for CI, then rerun `pnpm cf:deploy:immediate`.

## Open Questions

- UNCONFIRMED: whether the production Cloudflare token used by GitHub Actions can remove the old Queue consumer. Current local credentials cannot.

## Working Set

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/legacy-runner-wake-queue.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/test/index.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
