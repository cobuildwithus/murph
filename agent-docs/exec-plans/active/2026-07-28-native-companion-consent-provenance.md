# Correct native companion consent provenance

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Let both supported native clients use the existing authenticated launch-consent
  recovery endpoint without recording Android acceptance as iOS provenance.
- Keep the audit source server-owned rather than trusting a client-supplied
  platform label.

## Success criteria

- Native launch-consent acceptances are recorded with the generic
  `native-companion` source.
- A client-provided source remains untrusted and cannot select persisted audit
  provenance.
- Existing Privy bearer authentication, launch-scope restrictions, document
  version validation, grant persistence, and response behavior remain
  unchanged.
- Focused route proof, canonical verification, required ReviewGPT audits, CI,
  and production deployment complete successfully.

## Scope

- The hosted companion legal-consent route.
- Focused route coverage for server-owned provenance.
- Current architecture, security, and legal-consent owner documentation.

## Constraints

- No schema, migration, new state, new endpoint, or client-trust mechanism.
- Preserve the existing browser and iOS consent paths.
- Do not infer a platform from an unauthenticated request field.

## Evidence

- The Android client sends `source: "android-companion"` to the shared native
  legal-consent endpoint.
- The route currently ignores that value but persists the literal
  `ios-companion`, so a successful Android acceptance is mislabeled.
- The endpoint authenticates the member but has no platform-attestation signal;
  the smallest truthful source is therefore the server-owned
  `native-companion` label.

## Tasks

1. [x] Change the route's persisted source to `native-companion`.
2. [x] Update focused tests to prove an arbitrary client label remains ignored.
3. [x] Update the current legal-consent and trust-boundary documentation.
4. [ ] Run focused and canonical verification.
5. [ ] Complete preliminary and final ReviewGPT gates, CI, merge, and deployment
   proof.

## Verification log

- `pnpm --dir apps/web prisma:generate`
  - Passed; generated only ignored local client artifacts.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-companion-legal-consent-route.test.ts`
  - Passed: 1 file, 5 tests.
- `pnpm verify:acceptance`
  - Local admission was stopped after the documented ten-minute wait because
    an unrelated hosted-web verification still owned the shared slot.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`
  - Infrastructure failure before tests started: the installed
    `blacksmith-testbox` CLI rejects the dispatcher's `--stop-after` option.
  - The required acceptance gate remains pending and will run locally after the
    shared slot is free.
