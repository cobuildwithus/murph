# Add secret-safe Linq upstream diagnostics

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Make future Linq upstream failures distinguishable as provider API responses versus Cloudflare challenge-like responses without changing message delivery behavior.

## Success criteria

- Linq provider-egress completion logs identify the fixed allowlisted operation.
- Non-success Linq responses add only bounded, header-derived diagnostics: content kind, Cloudflare challenge signal, and a strictly validated optional Ray correlation value.
- The original upstream response body remains unread and unmodified by diagnostics.
- Focused tests prove useful fields and the absence of route identifiers, bodies, credentials, member identifiers, phone numbers, and arbitrary header values.
- Required verification, security/privacy review, coverage review, and PR review gates pass.

## Scope

- In scope: `apps/cloudflare/src/runner-egress-intercept.ts`, its focused test, this plan, and the coordination ledger.
- Out of scope: retries, fallback delivery, route authority changes, container lifecycle, mailbox ordering, response-body inspection, provider configuration, and deployment.

## Constraints

- Technical constraints: preserve the current route allowlist as the single source of truth; keep diagnostics synchronous and header-only; return the exact upstream `Response`.
- Product/process constraints: production is currently recovered, so this is observability-only and must not alter user-visible behavior.

## Risks and mitigations

1. Risk: diagnostics leak provider paths, message content, or user identifiers.
   Mitigation: emit fixed enums, one boolean, and a bounded validated correlation value only; assert negative privacy cases in tests.
2. Risk: diagnostics consume the response body or add latency.
   Mitigation: inspect headers only and test that the caller can still read the unchanged body.
3. Risk: concurrent PR #511 modifies the same source and test files.
   Mitigation: keep this patch narrow, avoid its replay/usage-authority symbols, and rebase before push.

## Tasks

1. [x] Replace the Linq boolean route matcher with a fixed operation classifier so authorization and diagnostics share one route decision.
2. [x] Add bounded header-only metadata to failed Linq upstream completion logs.
3. [x] Add focused behavior and privacy regression tests.
4. [x] Run focused verification, required local audits, and parent diff review.
5. [ ] Run CI and ReviewGPT on the exact pushed PR head before merge.

## Decisions

- Do not use the existing response-body metadata helper because it buffers the response and is unnecessary for this diagnosis.
- Treat `cf-mitigated: challenge` as the definitive Cloudflare challenge signal; treat content kind and a valid `cf-ray` only as correlation context.
- Do not deploy this observability patch as part of the recovered incident unless separately requested.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test:node test/runner-egress-intercept.test.ts`
  - `pnpm test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
  - Required `security-privacy-review` and `coverage-write` audit passes.
  - CI and ReviewGPT on the exact pushed PR head.
- Expected outcomes: all checks pass; failed Linq logs contain only the documented bounded metadata; upstream responses remain unchanged.

## Verification results

- `pnpm --dir apps/cloudflare test:node test/runner-egress-intercept.test.ts`: 216 tests passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts`: dependency, boundary, architecture, crypto, and raw-log guards passed; Cloudflare typecheck passed; 103 test files and 1,779 tests passed.
- `security-privacy-review`: no evidence-backed medium-or-higher findings.
- `coverage-write`: added one synthetic phone exclusion assertion; no unresolved coverage findings.
- Parent final review: response metadata is limited to actual upstream responses, and the rebased source/test patch remained byte-for-byte unchanged through ledger conflict resolution.
Completed: 2026-07-14
