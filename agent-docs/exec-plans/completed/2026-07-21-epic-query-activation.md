# Epic primary query activation

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Expand PR 824 so merging it activates all 24 primary Epic query scopes: the
  original three plus the 21 longitudinal additions.

## Success criteria

- New Epic connections request the unique SMART resource permissions needed by
  every primary query and freeze a deterministic 24-query retrieval plan.
- Whole-scope queries and bounded-window queries generate distinct, policy-owned
  requests; multiple query variants for one FHIR resource cannot collapse into
  one slice.
- Existing pre-protocol runs retain the original three-query lifecycle, while
  new query-slice runs execute the expanded plan.
- Every newly admitted primary FHIR resource family is accepted into the raw
  evidence pipeline with patient binding; unsupported canonical mappings remain
  explicit review-only evidence rather than being discarded.
- Dependency reads remain registration-only and no refresh/offline scope is
  requested.

## Scope

- In scope: Epic policy activation, OAuth resource-scope aggregation, provider
  directory policy snapshot, frozen retrieval-plan construction, initial page
  URL generation, admitted raw FHIR resource types, patient binding, focused
  tests, and current durable Epic guidance.
- Out of scope: dependency traversal, refresh tokens, canonical mapper expansion,
  provider-specific capability suppression, and multi-window historical backfill.

## Constraints

- Web remains the sole owner of Epic policy, credentials, patient context,
  provider URLs, and egress.
- Preserve partial-grant connection behavior and the product-critical connect,
  retrieval, raw-evidence, and import flows.
- Keep pre-protocol run behavior frozen instead of reinterpreting old rows under
  the new policy.
- Use one newest-first initial window for each bounded query; later backfill can
  add older windows without changing query identity.

## Tasks

1. Activate and order all primary queries and derive unique resource permission
   scopes with operation unions.
2. Build and validate deterministic whole/bounded slices for every granted
   primary resource family while preserving the legacy three-query reader.
3. Admit all primary FHIR resource families into raw evidence and correct their
   patient-reference ownership.
4. Refresh the owned provider policy snapshot, docs, and focused regression
   coverage.
5. Run required verification and coverage audit, commit and push the amendment,
   then complete exact-head CI and ReviewGPT.

## Decisions

- Activating the 21 additions means 24 primary query scopes, not 24 distinct
  resource types; SMART permissions are deduplicated by resource type while the
  retrieval plan preserves every query variant.
- Bounded queries receive one deterministic initial window ending at the run's
  frozen creation time. This activates useful current history without claiming
  that older backfill or adaptive slicing is complete.
- Registration-only dependency APIs remain unavailable to execution until the
  dependency-traversal owner lands.

## Verification

- `pnpm test:diff` passed for every affected owner and reverse dependent,
  including 18 package/app typechecks, the package suites and package-boundary
  checks, Web tests/lint/dev smoke/production build, and Cloudflare Node and
  Workers tests.
- `pnpm test:scenario-integrity` passed for 204 scenarios, 11 sample inputs,
  and 28 golden-output directories.
- The required coverage-write audit passed after adding exact 24-slice identity
  coverage plus correct-field and wrong-patient binding coverage for the four
  newly admitted raw resource families.
- Focused Epic policy, provider-directory, control-plane, retrieval, SMART,
  importer, and clinical-record contract tests passed.
- `pnpm docs:drift` and `git diff --check` passed.
Completed: 2026-07-21
Completed: 2026-07-21
