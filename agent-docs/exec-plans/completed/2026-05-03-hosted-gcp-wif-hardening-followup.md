# Hosted GCP WIF hardening follow-up

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Finish the production hosted crypto hardening follow-up by keeping the
  Vercel OIDC / GCP Workload Identity Federation token chain least-privileged,
  preventing raw Google provider messages from becoming production error
  messages, and documenting the required operator IAM shape.

## Success criteria

- Google API failures expose stable sanitized messages while preserving useful
  status/service metadata for logs.
- Focused hosted crypto tests cover the sanitized Google error path and the
  existing IAM-scope split.
- Hosted crypto docs describe the production WIF principal binding and KMS
  key-level roles without static service-account keys.
- Focused verification passes.
- A scoped commit lands the code, tests, docs, and completed plan.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-crypto/gcp-kms.ts`
  - `apps/web/test/hosted-crypto-gcp-kms.test.ts`
  - `apps/web/README.md`
  - `apps/web/.env.example`
- Out of scope:
  - Live GCP IAM mutation.
  - KMS key rotation or envelope format changes.
  - Broader hosted onboarding behavior.

## Constraints

- Technical constraints:
  - Production must keep using Vercel OIDC and GCP WIF, not static access
    tokens or service-account keys.
  - The STS token must remain IAMCredentials-capable and the generated service
    account token must remain Cloud-KMS-scoped.
  - Production endpoint overrides and local KMS remain fail-closed.
- Product/process constraints:
  - Preserve unrelated dirty work in the checkout.
  - Do not include local account, home directory, secrets, raw tokens, or raw
    Authorization headers in docs, tests, logs, or commits.

## Risks and mitigations

1. Risk: Sanitizing Google errors removes too much diagnostic signal.
   Mitigation: keep status, service/operation label, Google status/reason when
   available, and covered tests.
2. Risk: Docs drift operators toward broad project-level IAM.
   Mitigation: document principal-specific impersonation and key-level KMS role
   bindings.

## Tasks

1. Add a sanitized Google API error type and focused tests.
2. Document least-privilege WIF/KMS setup for hosted crypto.
3. Run focused verification and completion audits.
4. Close the plan and commit the scoped diff.

## Decisions

- Keep the two-hop token chain: Vercel OIDC -> STS token with IAM scope ->
  service-account token with Cloud KMS scope.
- Keep raw provider response messages out of production error messages.
- Use stable Google operation labels in errors/logs instead of request resource
  names, so KMS failures cannot expose full key resource paths.
- Allowlist Google RPC status tokens and otherwise fall back to numeric Google
  or HTTP status metadata.

## Progress

- Added `GoogleCloudApiError` with stable code/status/operation/reason metadata.
- Added focused tests for IAMCredentials raw-message redaction and KMS
  resource-name redaction, including non-JSON KMS error bodies.
- Documented least-privilege Vercel OIDC / GCP WIF and key-level KMS roles.
- Security/privacy audit findings were repaired locally.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/web/test/hosted-crypto-gcp-kms.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web exec eslint src/lib/hosted-crypto/gcp-kms.ts test/hosted-crypto-gcp-kms.test.ts`
  - `git diff --check -- apps/web/src/lib/hosted-crypto/gcp-kms.ts apps/web/test/hosted-crypto-gcp-kms.test.ts apps/web/README.md apps/web/.env.example agent-docs/exec-plans/active/2026-05-03-hosted-gcp-wif-hardening-followup.md`
- Expected outcomes:
  - Commands pass.
- Results:
  - Passed: focused hosted crypto Vitest, 11 tests.
  - Passed: focused hosted crypto ESLint.
  - Passed: scoped `git diff --check`.
  - Blocked by unrelated dirty hosted-web work: `pnpm test:diff` fails in
    legal consent/homepage tests and typecheck outside this task's files.
Completed: 2026-05-03
