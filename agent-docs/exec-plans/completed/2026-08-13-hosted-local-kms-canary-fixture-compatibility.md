# Execution Plan: Hosted-Local KMS Canary Fixture Compatibility

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Restore the hosted Junction and Stripe canaries by making their shared hosted-local KMS inputs satisfy the unchanged production CryptoKeyVersion resource-name contract.

## Success criteria

- Hosted-local generated authority-signing key versions use a positive decimal KMS version identifier.
- The shared hosted execution fixture uses a valid GCP project identifier and passes through the real local KMS signer.
- Focused harness and KMS tests plus Web, Cloudflare, and hosted-local-harness typechecks pass.
- Required ReviewGPT gates and exact-head CI pass before merge.
- Post-merge Junction and Stripe canaries reach their provider-owned scenarios without the KMS fixture error.

## Scope

- In scope: hosted-local KMS key-version generation, the shared hosted execution test fixture, and focused regression proof.
- Out of scope: production KMS validation, provider client behavior, live credentials, and unrelated deploy configuration.

## Constraints

- Technical constraints: keep `requireKmsCryptoKeyVersionName` fail-closed; preserve deterministic generated key identity and verification-keyring alignment.
- Product/process constraints: use the isolated PR lane, exact pushed-head ReviewGPT, CI, and post-merge live canary proof.

## Risks and mitigations

1. Risk: weakening validation could hide malformed resource names.
   Mitigation: change only fixture generation and test constants; add proof through the unchanged local KMS signer.
2. Risk: generated local signing identities could become unstable.
   Mitigation: derive the positive decimal version deterministically from the existing public-key fingerprint.

## Tasks

1. Correct generated and shared fixture CryptoKeyVersion names.
2. Add focused cross-boundary regression coverage.
3. Run focused tests and affected typechecks.
4. Push the exact candidate, run preliminary and final ReviewGPT with CI, resolve findings, and merge when green.
5. Confirm post-merge Junction and Stripe canaries.

## Decisions

- Preserve the existing full resource paths and deterministic SHA-256-derived identity; encode only the version identifier as a positive decimal.
- Do not add a second KMS-name parser to the harness; the Web KMS regression is the contract proof.

## Verification

- `pnpm exec vitest run --config vitest.config.ts test/dev-hosted-local/environment.test.ts --no-coverage` in `packages/hosted-local-harness`: 94 tests pass.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-crypto-gcp-kms.test.ts --no-coverage`: 23 tests pass.
- `pnpm typecheck` in `packages/hosted-local-harness`, `apps/cloudflare`, and `apps/web`: pass.
- Exact-head GitHub CI, preliminary specialist ReviewGPT, and final ReviewGPT: pending.
- Post-merge live Junction and Stripe workflows: pending.
Completed: 2026-08-13
