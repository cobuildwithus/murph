# Stripe reconciliation error telemetry

## Goal

Make the next failed or poisoned hosted Stripe receipt diagnosable from existing
production logs by retaining a privacy-safe processing stage plus the complete
available safe error classification (name, stable code, Stripe type/code/status,
and opaque request correlation when present).

Success means the existing reconciliation failure log answers which coarse
owner stage failed and what bounded error class/code was available, without
changing billing behavior, retries, receipt state, provider calls, alerting,
storage, or control flow.

## Scope

- Reuse the Web-owned hosted Stripe reconciliation log and existing Stripe-safe
  error-field parser.
- Add focused tests that prove typed fields and sanitization for representative
  plain, coded, Stripe-provider, and wrapped failures.
- Update the owning observability/runtime contract only if the new field schema
  needs durable documentation.
- Do not add a migration, new backend, metric, alert, queue, scheduler, retry,
  replay path, or production mutation.
- Do not touch device-sync code or surfaces.

## Evidence and question

- Four retained `customer.subscription.deleted` receipts from July 23–28 were
  poisoned with the generic durable code `Error`; provider retention had already
  expired for three when investigated.
- Current code derives the durable code from `error.code` or `error.name`, and
  the reconciliation-level log emits Prisma detail but otherwise only a
  sanitized message. It does not include the safe Stripe fields already exposed
  by `stripe-error-log.ts`, nor a reconciliation stage.
- Exact question for later production evidence: for each new failed/poisoned
  receipt, which coarse reconciliation stage failed, and what safe error name,
  stable code, Stripe type/code/status, or request correlation was available?
- Competing hypotheses to distinguish include provider event retrieval,
  event/domain application, post-commit side-effect cleanup, and receipt
  finalization failures.

## Constraints

- ReviewGPT authors all production telemetry code and its focused tests. The
  parent inspects and applies an accepted patch exactly.
- Typed fields must be low-cardinality. Stage values are a closed vocabulary;
  error tokens use existing validation and length bounds; opaque request IDs
  remain correlation metadata only.
- Never log payloads, messages/prompts/transcripts, customer/member/contact IDs,
  checkout contents, health values, raw errors, stacks, credentials, URLs,
  paths, or unsanitized provider messages.
- Emit once through the existing reconciliation failure log only; no added
  success-path volume or database load.
- Preserve existing retry, poison, alert, persistence, provider, and user-visible
  behavior exactly.

## Deduplication

- Open PR #2383 modifies the same reconciliation file for payment-notification
  email but does not own error telemetry. Keep this patch additive and
  conflict-minimal; do not edit or co-author its branch.
- No open issue, PR, recent merge, active task, or device-sync lane was found to
  own this telemetry question.

## Tasks

1. Obtain a scoped attachment patch from ReviewGPT against current `origin/main`.
2. Inspect privacy, security, cardinality, volume, runtime overhead, control-flow
   neutrality, file overlap, and exact question coverage before applying it.
3. Run focused Stripe reconciliation/logging tests, Web typecheck, privacy/log
   guards, billing/provider guards, and required completion audits.
4. Commit and push a draft PR, run preliminary and final exact-head ReviewGPT
   gates concurrently with CI, and resolve every accepted finding.
5. If every telemetry-only autonomous-merge condition is proven, merge through
   the protected path and verify the deployed Web revision read-only. Otherwise
   leave the PR ready and report the exact human action.

## Later verification query

In the next bounded production sweep, query Vercel production logs for the exact
message `Hosted Stripe event reconciliation failed.` over the latest two hours,
aggregate only the typed `stage`, `errorName`, `errorCode`, `stripeType`,
`stripeCode`, and `stripeStatusCode` fields, and compare with failed/poisoned
receipt counts and event types from `hosted_stripe_event`. Use the opaque request
ID only for one narrow Stripe CLI retrieve when needed; never report the raw ID.

## Outcome

- ReviewGPT authored the accepted production implementation and focused tests.
  The implementation adds four closed processing stages plus bounded safe error
  classification to the existing failure-only log and changes no persistence,
  retry, poison, provider, alert, billing, or user-visible behavior.
- Focused reconciliation proof passed with 87 tests, including every stage,
  direct and one-level provider classification, sanitization and exclusion of
  raw payload data, and the accepted specialist regression for hostile error
  metadata. Web typecheck, targeted lint, logging/privacy guards, hosted billing
  and provider-request guards, and diff hygiene also passed.
- Preliminary ReviewGPT accepted one test-only coverage finding for a throwing
  `cause` getter combined with an unsafe overlong error name. The exact
  ReviewGPT-authored regression test was applied and passed.
- Final ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` on the complete
  production patch with no qualifying finding.
- PR #2409 owns the telemetry boundary. Production convergence and the later
  natural-traffic query remain deployment-time checks rather than synthetic
  production traffic.
Status: completed
Updated: 2026-08-27
Completed: 2026-08-27
