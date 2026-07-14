# PR 570 ReviewGPT action authority follow-up

## Goal

Resolve the accepted exact-head ReviewGPT findings by making the web-owned
usage projection the sole source of usage-related billing actions and deleting
the unused conversational formatter.

## Scope

- Require complete Stripe billing identifiers before projecting an Edge upgrade.
- Feed Home's existing allowance decision through the projection and render
  action wording/CTA only from `recommendedAction`.
- Remove duplicate Settings action eligibility props from the usage band.
- Delete the unused conversational formatter and formatter-only tests.
- Add focused action-consistency coverage, then run routed web verification,
  commit, push, CI, and a fresh ReviewGPT round.

## Invariants

- Usage remains advisory and replies continue at 100%.
- Group usage remains unavailable and reveals no payer or shared balance.
- Internal currency values remain inside the web owner.
- Billing mutation routes retain final server-side revalidation.

## Completion evidence

- Focused web projection/Home/Settings/tool coverage: 5 files, 61 tests passed.
- Full web test suite: 409 files passed, 1 skipped; 4,930 tests passed,
  135 skipped.
- Web lint: 0 errors; 11 pre-existing warnings outside this change.
- Production build and TypeScript validation: passed; 189 pages generated and
  Health Commons trace leakage check passed.
- Direct security/privacy review: no medium-or-higher finding; member identity,
  group exclusion, percentage-only disclosure, and billing mutation
  revalidation remain unchanged.
- Direct frontend review: no blocking finding; action-free states remain
  informational and action labels/links come only from the projection.
- Coverage review: missing-customer and missing-subscription paid states, Home
  single-decision reuse, and Settings descriptor-only rendering are covered.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
