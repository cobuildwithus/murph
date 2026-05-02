# Device Sync And Cloudflare Correctness Fixes

## Goal

Land two narrow correctness fixes:

- Hosted device-sync stored OAuth token reads must distinguish nullable `tokenVersion` from invalid non-positive versions.
- Cloudflare hosted runtime crypto production detection must match the hosted web normalization for `NODE_ENV=production`, `VERCEL_ENV=production`, `HOSTED_CRYPTO_ENV=prod`, and `HOSTED_CRYPTO_ENV=production`.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Do not widen device-sync credential semantics beyond validation at the read boundary.
- Do not relax production authority-signature checks.
- Do not introduce new persisted state or dependencies.

## Working Set

- `apps/web/src/lib/device-sync/prisma-store/connection-secrets.ts`
- `apps/web/test/prisma-store-oauth-connection.test.ts`
- `apps/cloudflare/src/hosted-crypto/runtime-crypto-context.ts`
- `apps/cloudflare/src/env.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/hosted-runtime-crypto-context.test.ts`

## Verification Plan

- Focused hosted web Prisma-store test for token-version handling.
- Focused Cloudflare hosted runtime crypto-context test for production normalization.
- `pnpm typecheck`
- Scoped `pnpm test:diff` for touched files, if feasible in the current dirty checkout.
- Required security/privacy, coverage-write, and task-finish review passes per repo workflow.

## State

- 2026-05-02: Implementation complete. Focused web and Cloudflare regression tests passed. Scoped `test:diff` for the touched files passed. Root `pnpm typecheck` is blocked by unrelated hosted-web test typing plus a transient workspace-boundary scanner path.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
