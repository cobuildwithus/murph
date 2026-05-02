# Fail production HOSTED_WEB_BASE_URL on HTTP loopback

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Fail Cloudflare hosted worker startup/config parsing when `HOSTED_WEB_BASE_URL`
  is an HTTP loopback URL in production-indicating environments.

## Success criteria

- Production is detected from `HOSTED_CRYPTO_ENV`, `NODE_ENV`, or `VERCEL_ENV`.
- Development/test/local worker config still permits existing HTTP loopback behavior.
- Focused Cloudflare env tests cover production rejection and local allowance.
- Required scoped verification and completion audits pass or are reported with a
  clear unrelated blocker.

## Scope

- In scope: Cloudflare worker env reader and directly coupled tests.
- Out of scope: deploy-preflight private-network validation, hosted web public
  URL resolution, local proxy behavior, or broad hosted URL normalization.

## Constraints

- Technical constraints: preserve explicit `allowHostedWebHttpHosts` behavior for
  non-production/local callers; keep production failure fail-closed and early.
- Product/process constraints: preserve unrelated dirty work and avoid exposing
  local identifiers in generated artifacts or commit content.

## Risks and mitigations

1. Risk: Blocking local development fixtures that intentionally use loopback.
   Mitigation: gate the stricter behavior only on production indicators and add
   tests for local/test allowance.
2. Risk: Diverging from existing production-detection semantics.
   Mitigation: mirror the existing crypto production indicators:
   `HOSTED_CRYPTO_ENV`, `NODE_ENV`, and `VERCEL_ENV`.

## Tasks

1. Inspect the env reader and current URL normalization tests.
2. Add production-only HTTP loopback rejection for `HOSTED_WEB_BASE_URL`.
3. Add focused tests for production rejection and non-production allowance.
4. Run scoped verification and required audits.
5. Inspect the diff for identifier leakage and commit the scoped change.

## Decisions

- Treat `prod` and `production` as production for `HOSTED_CRYPTO_ENV`; treat
  `production` as production for `NODE_ENV` and `VERCEL_ENV`.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test -- env.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff apps/cloudflare/src/hosted-execution-worker-env.ts apps/cloudflare/test/env.test.ts`
- Expected outcomes: focused env tests pass; typecheck and diff-aware scoped
  verification pass or expose an unrelated pre-existing blocker.
Completed: 2026-05-02
