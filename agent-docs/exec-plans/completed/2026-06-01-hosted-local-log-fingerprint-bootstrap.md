# Hosted-local log fingerprint secret bootstrap

Status: completed
Created: 2026-06-01
Updated: 2026-06-01

## Goal

- Make hosted-local dev and hosted-local E2E bootstrap `HOSTED_LOG_FINGERPRINT_SECRET`
  automatically so the generated Worker secret surface is complete without
  manual local secret setup.

## Success criteria

- `pnpm dev` / `pnpm dev:reset` generated Worker env includes a stable local
  `HOSTED_LOG_FINGERPRINT_SECRET` when no shell or persisted value exists.
- Hosted-local E2E isolation gets the same generated secret path.
- The secret stays Worker-only and is not forwarded into child/runtime env.
- Focused tests prove generation, persistence, and local Worker config inclusion.

## Scope

- In scope: `scripts/dev-hosted-local/**` bootstrap/persistence logic and focused
  tests for generated hosted-local env.
- Out of scope: production deploy secret requirements, provider credential
  forwarding, child env allowlists, Cloudflare runtime request fingerprinting
  behavior.

## Constraints

- Technical constraints: keep the generated value local-only, persist it with the
  hosted-local generated state, preserve existing remote/shell override
  precedence, and do not print secret values in tests or logs.
- Product/process constraints: preserve unrelated dirty Cloudflare/runtime work
  in the current checkout and finish through the plan-bearing scoped commit path
  if safe.

## Risks and mitigations

1. Risk: A generated Worker secret accidentally reaches the runner child env.
   Mitigation: Reuse the existing Worker-only env boundary and run focused tests
   around hosted-local state/config generation instead of widening env profiles.
2. Risk: E2E isolation regenerates the secret every restart and breaks stable
   fingerprints during a scenario.
   Mitigation: Persist through the same hosted-local state file as the existing
   generated crypto keys.

## Tasks

1. Done: inspected hosted-local generated state names and environment merge behavior.
2. Done: generated/persisted `HOSTED_LOG_FINGERPRINT_SECRET` for hosted-local dev
   and E2E when absent.
3. Done: added focused tests for merge, persistence, Worker env rendering, and
   Worker config inclusion.
4. Done: ran focused verification and direct `pnpm dev` bootstrap proof.
5. Done: completed final verification and scoped commit handoff.

## Decisions

- Use the existing local secret generator primitive (`randomBytes(32).toString("base64")`
  through `createEnvelopeKey`) for this metadata-only HMAC key instead of adding
  a new secret-generation abstraction.

## Verification

- Passed: `pnpm test:repo-tools scripts/dev-hosted-local/environment.test.ts`
  (1 file, 70 tests).
- Passed: `pnpm test:diff scripts/dev-hosted-local/constants.ts scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts`
  (repo-internal fast path, repo guards, repo TS tools typecheck, 30 repo-tools
  test files / 298 tests, dependency policy).
- Passed: `pnpm typecheck`.
- Passed: rerun `pnpm test:repo-tools scripts/dev-hosted-local/environment.test.ts`
  after the hosted-local E2E commit (1 file, 70 tests).
- Passed: rerun `pnpm typecheck` after the hosted-local E2E commit.
- Passed: `git diff --check -- scripts/dev-hosted-local/constants.ts scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts agent-docs/exec-plans/active/2026-06-01-hosted-local-log-fingerprint-bootstrap.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Passed: final scoped privacy scan for local identifiers, bearer tokens,
  live Stripe keys, webhook secrets, and private key blocks.
- Direct proof: restarted `pnpm dev`; hosted-local harness became ready, web and
  Worker were available locally, deploy smoke passed, and Wrangler listed
  `HOSTED_LOG_FINGERPRINT_SECRET` as a hidden local Worker env binding without
  the previous missing-secret warning.
Completed: 2026-06-01
