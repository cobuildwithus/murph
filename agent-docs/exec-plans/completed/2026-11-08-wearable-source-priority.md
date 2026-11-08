# Prefer wearable readings over merged health-store copies

Status: completed
Created: 2026-11-08
Updated: 2026-11-08

## Goal

Use a wearable's own readings when a health-store copy is also available. Do not infer Apple Watch ownership from Apple Health ingestion.

## Product UX

Outcome: device readings and their source remain aligned in private number charts and rankings.
Reaches: members with WHOOP and Apple Health data; health-store-only members retain their readings.
Proof: synthetic competing-source, fallback, provider-filter and projection tests, followed by native ranking tests.

## Scope and constraints

- Fix selection in the query owner; retain every candidate for provenance suppression.
- Preserve steps' existing worn-coverage rule and provider-scoped reads.
- Keep RHR series on a recent known wearable rather than letting a health-store-only day relabel its average.
- Native RHR ranking must not treat an unknown source as Apple Watch.
- No canonical health writes, private fixtures, new dependencies or account-specific rules.

## Tasks

1. Reproduce source selection with synthetic same-day records.
2. Correct selection and projection freshness; verify composed number output and fallback.
3. Add native unknown-source regression and focused verification in its separate repository.
4. Publish reviewed PRs and prepare compatible deployment; retain live delivery receipts in the PR and native release packet.

## Verification

Query wearable/projection and legacy schema regression: 159 tests passed. Junction import-to-MetricPoint attribution: 2 composed tests passed. Companion route: 41 tests passed; changelog: 4 tests passed. Query, vault-usecase and Web typechecks passed; complexity diff passed with lower projection complexity. Native builds, 43 ranking tests and 76 phone UI tests passed. Native PR 495 merged and exact merged-main CI passed. Both backend review rounds and the native review passed without qualifying findings.

Backend PR: https://github.com/cobuildwithus/murph/pull/4738.

## Risks

- Health-store-only days must remain available when no current wearable source exists.
- Old projections need normal owner-led rebuilds; canonical history remains unchanged.
- Existing steps coverage and source-specific queries must not change.

## Junction attribution verification

Reviewed Junction data-attribution, calculated-metric, Apple HealthKit, activity
summary, heart-rate timeseries and device API documentation, plus the installed
iOS SDK source. The explicit Apple HealthKit `watch` tag identifies Apple Watch;
`unknown` and `multiple_sources` do not. The SDK's daily RHR statistics do not
carry the originating sample identity, so connected-device presence cannot be
used to relabel those readings. Pass an explicit watch tag into the existing RHR
source label and keep unattributed data unranked. A composed synthetic import
checks the documented API shape through canonical import and saved MetricPoints.

## Completion and delivery handoff

Implementation and review are complete. Native PR 495 merged as
`7adaedb58ae414bae4377bb1773ea4a9a82d9521`; main CI `42520942546` passed.
Backend round 2 reviewed `5f0068cde7ecf097922f4746cf9394abeafdc7fb`.
This final plan/index edit changes no behavior. Remaining release operations
are exact-head backend CI and merge, compatible Web/runner deployment, and
TestFlight build 91 upload/availability verification. Delivery remains owned by
the same task; this implementation record is not a claim that production or
TestFlight is already updated. Retain final receipts in the PR and native
release packet rather than rewriting this completed record.
Completed: 2026-11-08
