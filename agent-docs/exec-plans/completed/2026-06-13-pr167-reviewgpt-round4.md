# PR 167 ReviewGPT Round 4

## Goal

Land the accepted ReviewGPT round-4 fixes for PR #167's hosted transcription
usage accounting changes.

Success criteria:

- Malformed Workers AI audio rows fail closed instead of being accounted at zero
  allowance cost.
- Hosted transcription metering scans all provider segments when top-level
  duration is absent, without expanding the returned transcript payload.
- Hosted transcription usage-record posting reuses the shared web-control usage
  record seam instead of duplicating route/signing/transport logic.
- Focused tests and required verification pass, then the PR branch is pushed and
  the next ReviewGPT/CI round starts.

## Scope

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/src/runtime-platform/usage-record-port.ts`
- relevant Cloudflare tests

## Constraints

- Keep the fix narrow; do not introduce persisted idempotency state or broad
  transport abstractions.
- Preserve hosted audio privacy boundaries: no audio bytes, transcript text, or
  raw provider payloads in logs/tests.
- Keep response segment truncation separate from metering.

## Verification

Planned:

- focused web usage-allowance tests
- focused Cloudflare egress tests
- `pnpm test:diff` for touched files if truthful
- completion workflow audits required for billing/runtime/trust-boundary code
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
