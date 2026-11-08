# Prefer wearable readings over merged health-store copies

Status: active
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
4. Review, publish scoped PRs, complete required checks and ship under the task's existing delivery authorization.

## Verification

Pending focused query and companion-route tests, typechecks, complexity diff, native build/tests, required PR review and CI.

## Risks

- Health-store-only days must remain available when no current wearable source exists.
- Old projections need normal owner-led rebuilds; canonical history remains unchanged.
- Existing steps coverage and source-specific queries must not change.
