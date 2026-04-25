# Require authenticated hosted-email sender routing

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Hosted email ingress must not authorize reply-alias or direct/public sender routes from spoofable SMTP envelope or RFC5322 `From` fields alone.

## Success criteria

- Cloudflare ingress forwards an explicit provider-authenticated sender verdict to the web route resolver.
- Web route resolution fails closed when the authenticated sender verdict is absent, failing, or unaligned.
- Direct/public sender routing remains disabled unless the authenticated verdict proves the same sender address used for lookup.
- Regression coverage proves matching envelope/header `From` values for a verified email route to `null` without a passing authenticated verdict.

## Scope

- In scope:
  - Hosted email ingress worker route-resolution callback payload.
  - Shared hosted-email callback contracts.
  - Runtime-state hosted-email sender authorization helpers.
  - Focused hosted email route tests.
- Out of scope:
  - Changing outbound email delivery behavior.
  - Adding a new email provider.
  - Broad hosted execution wake/run refactors.

## Constraints

- Technical constraints:
  - Preserve the current signed Cloudflare-to-web callback boundary.
  - Do not log raw email addresses, message bodies, or provider headers.
  - Avoid trusting user-controlled email headers as provider authentication.
- Product/process constraints:
  - Preserve unrelated dirty work and active hosted rows.
  - Keep reply aliases as route hints only; they do not prove sender identity.

## Risks and mitigations

1. Risk: Cloudflare Email Workers may expose provider auth only through `Authentication-Results` style data.
   Mitigation: Do not parse raw message auth-result headers for trust; fail closed unless a non-message-controlled provider metadata field supplies the verdict.
2. Risk: Direct/public sender routing could remain spoofable through fallback behavior.
   Mitigation: Require the same authenticated aligned sender address before the DB lookup.

## Tasks

1. Trace the hosted-email callback contract and runtime-state helpers.
2. Add and parse an authenticated sender verdict at ingress.
3. Require the verdict in web route resolution for reply aliases and direct/public sender lookup.
4. Add focused regression coverage for spoofed matching `From` fields without auth.
5. Run targeted checks, required audits, and final verification.

## Decisions

- Treat absent provider authentication as unauthorized rather than as a soft warning.
- Treat raw `Authentication-Results` and `ARC-Authentication-Results` headers as attacker-controlled message content, not provider proof.
- Fail closed before web callback route lookup and before web-side DB lookups when the authenticated sender verdict is absent or failing.

## Verification

- Passed:
  - `pnpm --dir packages/runtime-state exec vitest run test/hosted-email.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution-builders-hosted-email.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-execution-email-callback-routes.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-routes.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
  - `git diff --check -- <touched paths>`
  - `pnpm typecheck`
- Partial:
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` passed broad package typecheck/test fanout, then failed in `apps/cloudflare verify` during Health Commons generation with `Unexpected array indentation` from unrelated dirty `packages/health-commons/**` content.
- Audit outcomes:
  - Simplify pass: low early-guard/raw-parser concerns addressed.
  - Security/privacy pass: high raw auth-result header trust concern fixed by removing raw-header trust and adding forged-header regression coverage.
  - Coverage-write pass: added missing parser, direct-public null-verdict, and forged header regressions.
  - Task-finish review: no issues found.
Completed: 2026-04-25
