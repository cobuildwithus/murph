# Linq webhook subscription convergence

Status: completed
Created: 2026-06-30
Updated: 2026-06-30

## Goal

- Stop hosted-local `pnpm dev:reset` from creating duplicate exact Linq webhook subscriptions when the provider list endpoint omits an existing subscription's signing secret.
- Preserve production Linq webhook subscriptions and avoid adding provider cleanup automation.

## Success criteria

- Exact active local webhook subscriptions are reused when the configured local secret is verified by the repo-local fingerprint cache.
- Exact active subscriptions with hidden provider secrets fail clearly when the local secret cannot be verified instead of creating another duplicate.
- Focused hosted-local harness tests and typecheck pass.

## Scope

- In scope:
  - `packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts`
  - `packages/hosted-local-harness/test/dev-hosted-local/linq-webhook-tunnel.test.ts`
- Out of scope:
  - provider subscription deletion
  - production Linq subscription mutation
  - new schedulers, queues, durable provider state, or cleanup automation

## Constraints

- Do not read, print, or persist raw secrets.
- Keep the cache secret-safe: store only an HMAC fingerprint and metadata.
- Prefer convergence/fail-closed behavior over automatic provider mutation.

## Decisions

- Trust a hidden-secret exact subscription only when the local `LINQ_WEBHOOK_SECRET` matches the secret-safe registration cache for the same target/event/phone shape, and reject mismatched cached subscription ids when both ids are known.
- If the exact subscription exists but the secret cannot be verified, stop with a clear error rather than creating another exact subscription.
- Canonicalize the phone-number set inside the cache fingerprint so reordered configured numbers do not make an otherwise exact subscription fail verification.

## Verification

- Passed:
  - `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts --no-coverage test/dev-hosted-local/linq-webhook-tunnel.test.ts -t "verified local secret|legacy local cache|phone-number order"`
  - `pnpm --dir packages/hosted-local-harness typecheck`
  - `pnpm typecheck`
  - `pnpm test:diff packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts packages/hosted-local-harness/test/dev-hosted-local/linq-webhook-tunnel.test.ts`
  - `git diff --check`
Completed: 2026-06-30
