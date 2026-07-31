# Product feedback digest

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Deliver one privacy-bounded daily operator digest of hosted product-feedback
  counts through the existing operational Resend transport.

## Success criteria

- The digest contains only fixed server-owned counts of the three allowlisted
  product-feedback kinds and never reads or includes model-authored summary
  text, member identifiers, contact details, raw conversation text, health
  data, provider payloads, or internal feedback ids.
- The daily read and email payload are explicitly bounded, deterministically
  ordered, protected from duplicate retry delivery, retried within the 6pm
  hour, and correct across Eastern time-zone offset changes.
- The authenticated cron route, production cron allowlist, Prisma schema, and
  migration stay aligned.
- Focused tests, typecheck, direct scenario proof, preliminary
  product-experience/coverage review, final ReviewGPT, exact-head CI,
  parent final review, and mergeability complete with no unresolved accepted
  finding.

## Scope

- In scope: the supplied product-feedback digest patch; directly affected
  hosted Web email/config/cron owners; the product-feedback index migration;
  focused tests; security, reliability, architecture, and testing documentation
  required to describe the shipped boundary.
- Out of scope: changing product-feedback capture semantics, adding a digest
  delivery table or retry queue, exposing feedback in a user-facing UI, or
  adding a new email provider.

## Constraints

- Treat the supplied patch as behavioral intent rather than overwrite
  authority.
- Reuse the existing Vercel cron authentication and Resend plain-text transport.
- Treat the allowlisted feedback kind as the only operator-disclosure-safe
  projection; do not retrieve the model-authored summary, member relations, or
  other private row content.
- Prefer a bounded aggregate and same-hour idempotent attempts over a new
  cursor, scheduler, delivery store, or reconciliation service.

## Risks and mitigations

1. Risk: an unbounded daily query or email grows beyond safe runtime/provider
   limits.
   Mitigation: group only the three allowlisted kinds and render fixed labels.
2. Risk: feedback content leaks identity or health context through the digest.
   Mitigation: never read free-form summary text; disclose only fixed counts to
   a dedicated recipient allowlist.
3. Risk: duplicate cron invocation sends duplicate mail.
   Mitigation: retain one deterministic day-keyed Resend idempotency key and
   verify ambiguous-failure retry through an isolated provider fake.
4. Risk: the new cron or migration bypasses production guardrails.
   Mitigation: update the approved cron-path and migration inventories and run
   their focused tests.

## Tasks

1. Apply and inspect the supplied patch against current `main`.
2. Correct boundedness, privacy, reliability, documentation, and production
   guard gaps at their existing owners.
3. Run focused tests, Web typecheck, migration/config proof, and direct
   deterministic digest scenarios.
4. Commit and push a candidate, open the PR, then run the preliminary
   product-experience/coverage ReviewGPT pass and final ReviewGPT concurrently
   with CI.
5. Resolve accepted findings, run parent final review, close this plan with the
   scoped final commit, and prove final CI and mergeability.

## Decisions

- Classify this as a high-risk cross-cutting Web change because it adds an
  authenticated runtime entrypoint, external email egress, and a database
  index.
- Product experience applies to the proactive digest timing, recipient,
  content, empty-state, and recovery contract. Coverage applies because
  executable behavior, schema, migration, and deploy configuration change.
- Prompt and frontend lenses do not apply because the change alters neither the
  provider-visible prompt stack nor user-facing Web presentation.
- The final ReviewGPT gate applies because external egress, cron idempotency,
  deploy configuration, and persisted schema are in scope.
- Preliminary and final round-one review both found that free-form summaries
  were not a mechanical disclosure boundary and that one hourly attempt had no
  owned recovery. The accepted correction uses only the existing allowlisted
  kind, fixed server labels, ten-minute same-hour wakes, and the existing
  provider idempotency primitive.

## Verification

- Focused Vitest coverage for digest behavior, cron authentication, shared
  email config, migration inventory, and approved production cron routes.
- `pnpm --filter web typecheck`
- `git diff --check`
- Direct deterministic readback of the prior-day fixed-kind aggregate,
  no-feedback behavior, dedicated recipient list, missing-config failure, and
  same-window/day-key retry through an isolated loopback provider fake.
