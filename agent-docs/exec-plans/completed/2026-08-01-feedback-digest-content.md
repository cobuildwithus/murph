# Feedback digest includes feedback content

Status: completed
Created: 2026-08-01

## Goal

- The daily internal product-feedback digest email shows the sanitized feedback
  summaries grouped by kind, not only counts, so operators can act on the
  feedback without a database read.

## Why now

- The owner reviewed the 2026-07-31 digest ("Feature requests: 4, Product
  frustrations: 6") and explicitly asked for the actual feedback in the email.
  This is an owner decision that supersedes the counts-only disclosure boundary
  accepted in `2026-07-30-product-feedback-digest.md`.
- The privacy posture changed since that decision: summaries are now
  deterministically scrubbed of high-confidence contact details and
  secret-shaped tokens at capture (`sanitizeHostedProductFeedbackSummary`), and
  capture policy already forbids health data, raw user wording, identifiers,
  and provider payloads in the summary.

## Success criteria

- The digest email renders each allowlisted kind as a fixed server-owned label
  with its count, followed by that kind's summaries, in deterministic order.
- The read stays bounded independently of row volume (fixed row cap with an
  explicit truncation line) and selects only `kind` and `summary` — never the
  member relation or id, internal feedback id, changelog metadata, or any other
  private row content.
- Timing, cron auth, empty-window behavior, missing-config fail-before-read,
  and the day-keyed Resend idempotency retry contract are unchanged.
- Durable docs that assert the counts-only boundary (ARCHITECTURE.md,
  agent-docs/SECURITY.md, agent-docs/RELIABILITY.md,
  agent-docs/operations/verification-and-runtime.md,
  agent-docs/references/testing-ci-map.md) are updated to the new boundary in
  the same change.
- Focused digest/cron tests, Web typecheck, exact-head CI, preliminary
  specialist ReviewGPT pass, and the final ReviewGPT gate (email egress +
  data-exposure trigger) complete with no unresolved accepted finding.

## Scope

- In scope: `apps/web/src/lib/hosted-execution/product-feedback-digest.ts`,
  its tests, and the durable-doc boundary updates above.
- Out of scope: capture semantics, sanitization rules, new tables/queues,
  recipient changes, send-hour changes, HTML email.

## Risks and mitigations

1. Risk: summaries leak identity/health content into email.
   Mitigation: capture-side scrub plus capture policy already bound summary
   content; the digest renders summaries verbatim without adding metadata, and
   recipients remain the dedicated operator allowlist.
2. Risk: unbounded window growth breaks the email or query.
   Mitigation: fixed row cap (200) with one extra-row truncation probe and an
   explicit truncation line, restoring the pre-hardening bounded-read shape.
3. Risk: duplicate delivery on retry.
   Mitigation: unchanged day-keyed Resend idempotency key.

## Verification

- `pnpm vitest run test/hosted-product-feedback-digest.test.ts test/hosted-product-feedback-digest-cron.test.ts` (apps/web)
- `pnpm --filter web typecheck`
- `git diff --check`
- Exact-head CI green; preliminary specialist ReviewGPT pass and final
  ReviewGPT gate on the pushed head.

## Completion

- The digest read replaced the three-kind groupBy count aggregate with one
  bounded `findMany` selecting only `kind` and `summary` (200-row cap, +1
  truncation probe, `createdAt asc, id asc` ordering, non-null summary
  filter). The email now renders each kind label with its count and summaries
  and appends one truncation line on overflow; empty-window, send-hour,
  config-fail-before-read, and day-keyed idempotency behavior are unchanged.
- Owner decision recorded: including capture-scrubbed summaries in the
  operator digest supersedes the counts-only boundary accepted in
  `2026-07-30-product-feedback-digest.md`; the disclosure guard moved to the
  capture-side deterministic scrub plus capture policy.
- Focused proof: 10/10 tests across `hosted-product-feedback-digest.test.ts`
  and `hosted-product-feedback-digest-cron.test.ts`, `apps/web` typecheck,
  `git diff --check` clean. Implementation ran in the parent because the c1
  Codex lane reported usage-limit exhaustion until 2026-08-05.
Completed: 2026-08-01
Updated: 2026-08-01
Completed: 2026-08-01
