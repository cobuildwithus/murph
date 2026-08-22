# Retire native E2E aliases before deployments

Status: active
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Keep the shared native hosted E2E Vercel target reusable by removing only
  aliases proven to belong to a lane-owned deployment before deleting it.
- Restore candidate deployments that currently remain in `BUILDING` after
  their build artifacts are ready because the automatic environment alias
  still points to a deleted deployment.

## Success criteria

- Retirement enumerates aliases through each already-validated lane-owned
  deployment's exact API endpoint and deletes those aliases before deleting
  the deployment.
- Alias responses that are incomplete or malformed fail closed without
  deleting anything unrelated.
- Focused controller tests, exact-head CI, and the required review gates pass.
- A protected native controller creates a ready candidate and reaches native
  dispatch after the existing orphan is removed safely.

## Scope

- In scope:
  - The shared native iOS/Android Vercel retirement helper and focused tests.
  - One bounded repair of the already-orphaned dedicated E2E alias after the
    active controller releases the lane.
- Out of scope:
  - Production Vercel deployments, aliases, or domains.
  - Changes to native app behavior or protected credential values.

## Risks and mitigations

1. Risk: deleting an alias owned by another deployment.
   Mitigation: enumerate aliases only through the exact validated deployment
   endpoint and delete only the returned immutable alias identifiers.
2. Risk: partial alias cleanup is mistaken for safe deployment retirement.
   Mitigation: fail closed on pagination, malformed responses, or non-success
   deletion responses; delete the deployment only after all aliases succeed.
3. Risk: the live controller and repair race on the same target.
   Mitigation: do not mutate provider state until the current controller has
   completed its own cleanup and released the shared concurrency lane.

## Tasks

1. Add failing focused tests for alias-before-deployment retirement and strict
   owner validation.
2. Implement the smallest Vercel alias cleanup inside the existing retirement
   owner and run focused proof.
3. Commit, push, open the PR, run the required specialist/final review gates
   with CI, and remediate accepted findings.
4. Repair the current orphan only after the live lane releases, then prove a
   protected candidate reaches native dispatch.

## Verification

- `node --test scripts/native-ios-hosted-e2e.test.mjs`
- `node --test scripts/native-android-hosted-e2e.test.mjs`
- Focused exact-owner lifecycle tests added for alias cleanup ordering and
  malformed/cross-owner failure.
- Names-only Vercel inspection showing no orphan alias and a subsequent
  candidate transition to `READY` before native dispatch.
