# Fix hosted GCP WIF IAMCredentials token scope

Status: verifying
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Fix production hosted onboarding failures where web-side hosted crypto
  provisioning reaches Google IAMCredentials `generateAccessToken` with an
  insufficiently scoped federated token.

## Success criteria

- Vercel OIDC to Google STS exchange requests an OAuth scope that can call
  IAMCredentials service-account impersonation.
- The final generated service-account access token remains scoped only to Cloud
  KMS for hosted crypto encrypt/decrypt/sign calls.
- Focused hosted-web tests cover both token-exchange and generated-token scopes.
- Production environment metadata is checked without printing secrets.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-crypto/gcp-kms.ts`
  - Focused hosted crypto tests.
  - Production metadata checks through Vercel/GCloud CLIs that do not reveal
    secret values.
- Out of scope:
  - Static production access tokens.
  - Cloudflare runner crypto authority changes.
  - KMS key rotation, envelope format changes, or broader hosted onboarding
    behavior.

## Constraints

- Do not print or commit secrets, raw env values, private keys, local paths, or
  personal identifiers.
- Keep Cloudflare without GCP KMS decrypt authority.
- Preserve unrelated dirty work and active hosted onboarding/runtime rows.

## Risks and mitigations

1. Risk: Widening the final service-account token scope more than needed.
   Mitigation: keep `generateAccessToken.scope` set to Cloud KMS only.
2. Risk: Misdiagnosing IAM role/policy failure as an OAuth scope failure.
   Mitigation: confirm required production env names and enabled Google APIs,
   and preserve the production error distinction in tests.

## Tasks

1. Inspect hosted crypto token exchange and onboarding call paths.
2. Check production Vercel/GCloud metadata without secret disclosure.
3. Patch the STS exchange scope and add focused regression coverage.
4. Run focused tests, typecheck/verification as feasible, required audits, and
   commit scoped changes if the worktree allows.

## Decisions

- The production error occurs before KMS calls: IAMCredentials rejects the
  federated token used to call `generateAccessToken`. The federated token needs
  IAM/API authority for the impersonation call, while the resulting service
  account token should stay KMS-scoped.

## Verification

- Passed:
  - `pnpm exec vitest run apps/web/test/hosted-crypto-gcp-kms.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web exec eslint src/lib/hosted-crypto/gcp-kms.ts test/hosted-crypto-gcp-kms.test.ts`
  - `pnpm exec vitest run apps/web/test/hosted-crypto-env.test.ts apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-crypto-gcp-kms.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `git diff --check -- apps/web/src/lib/hosted-crypto/gcp-kms.ts apps/web/test/hosted-crypto-gcp-kms.test.ts agent-docs/exec-plans/active/2026-05-02-hosted-gcp-wif-token-scope.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Blocked unrelated:
  - `pnpm --dir apps/web typecheck` fails before TypeScript because Health
    Commons generation reports `Unexpected object indentation`.
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-crypto/gcp-kms.ts apps/web/test/hosted-crypto-gcp-kms.test.ts` reaches
    `apps/web verify`, then dev smoke fails on the same unrelated Health
    Commons generation parse error.
  - `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false` fails on an
    unrelated active metrics type mismatch in `packages/query/src/metrics/index.ts`
    where a `MetricPoint` construction is missing `grain`.
