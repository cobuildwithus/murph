# Hosted Local HTTP Bridge

## Goal

Fix the deploy workflow hosted-local E2E gates that fail when the local hosted runner validates a container-reachable HTTP bridge URL for hosted web callbacks.

Success criteria:

- Local proxy mode can use the explicit container bridge host for hosted web callbacks.
- Production hosted execution still rejects HTTP hosted web base URLs.
- Focused Cloudflare env tests cover both paths.

## Scope

- `apps/cloudflare/src/env.ts`
- `apps/cloudflare/src/hosted-execution-worker-env.ts`
- `apps/cloudflare/src/hosted-crypto/runtime-user-crypto-context.ts`
- `apps/cloudflare/src/hosted-email/routes.ts`
- `apps/cloudflare/src/hosted-email/transport.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/runner-outbound/results.ts`
- `apps/cloudflare/src/runner-outbound/web-control.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/web-control-plane-email-ingress.ts`
- `apps/cloudflare/test/env.test.ts`

## Constraints

- Preserve existing production HTTPS and local-proxy opt-in rules.
- Do not weaken auth, secrets, or hosted control-plane boundaries.
- Do not touch unrelated active worktree edits.

## Verification

- Focused Cloudflare env tests: passed.
- `apps/cloudflare` typecheck: passed.
- `pnpm test:diff ...`: started, then stopped after blocking behind an unrelated workspace acceptance lock.
- `pnpm hosted-local e2e linq-delivery`: got past runner bundle assembly and database reset, then stopped after blocking behind the same unrelated workspace acceptance lock during setup.

## State

- Now: fix implemented; broad verification and scoped commit are blocked by unrelated shared-worktree verification and overlapping dirty files.
- Next: rerun `pnpm test:diff ...` and `pnpm hosted-local e2e linq-delivery` once the unrelated workspace verification lock and overlapping dirty work are clear.
