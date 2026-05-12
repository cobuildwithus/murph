# Fence hosted provider credential reads

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Require hosted runtime write-fence authority before the Cloudflare outbound
  intercept injects Linq, Telegram, or WhatsApp credentials, including
  credential-backed read operations.

## Success criteria

- Linq `GET /api/partner/v3/phone_numbers` requires a valid runtime write
  fence before `LINQ_API_TOKEN` is injected.
- Telegram `getFile` requires a valid runtime write fence before the bot token
  sentinel is rewritten.
- Existing credential injection still strips runtime authority headers before
  upstream provider fetches.

## Scope

- In scope: `apps/cloudflare/src/runner-egress-intercept.ts` and focused
  `apps/cloudflare/test/runner-egress-intercept.test.ts` coverage.
- Out of scope: provider-effect tunnel removal, hosted-local E2E behavior,
  runtime-platform refactors, and direct provider client redesign.

## Constraints

- Preserve unrelated active hosted-runner work and dirty local edits.
- Do not expose provider tokens, local identifiers, or request payloads in
  diagnostics, tests, docs, or final handoff.
- Keep provider read exceptions explicit if any are later allowed.

## Risks and mitigations

1. Risk: stale or unauthenticated hosted child code could enumerate provider
   account-scoped data through credential-injected read APIs.
   Mitigation: enforce the same runtime write-fence check for all currently
   allowed Linq, Telegram, and WhatsApp credential-injected requests.

## Tasks

1. Register this plan and matching coordination-ledger row.
2. Patch the intercept so Linq and Telegram authorize before all credential
   injection, not only mutating calls.
3. Add focused regressions for Linq phone-number reads and Telegram `getFile`.
4. Run focused Cloudflare verification and required audit passes.
5. Close the plan through the repo completion path if a safe scoped commit is
   possible.

## Decisions

- Reuse the existing `requestOwnsRuntimeWriteFence` helper because current
  credential injection is invocation-scoped and should require the workspace
  version-bearing write fence.

## Verification

- Commands to run: focused Cloudflare runner-egress-intercept tests, Cloudflare
  app verification or truthful diff verification per repo policy, plus required
  security/privacy, coverage, and completion review passes.
Completed: 2026-05-12
