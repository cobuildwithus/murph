# Retire native E2E aliases before deployments

Status: completed
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

1. Completed: added focused tests for alias-before-deployment retirement,
   strict owner validation, multi-alias ordering, second-alias failure, and
   pagination rejection before mutation.
2. Completed: implemented alias cleanup inside the existing Vercel retirement
   owner and ran the focused iOS and shared Android controller proof.
3. Completed: opened PR #2155, passed exact-head CI and final ReviewGPT round
   2, and resolved the accepted preliminary pagination finding.
4. Completed without a repair mutation: the stale alias was absent after the
   prior controller released the lane; the next protected candidate reached
   `READY`, owned the custom-environment alias, and dispatched the exact v9
   Android tag. Its later native permission-state failure is a separate
   Android test-driver issue.

## Verification

- `node --test scripts/native-ios-hosted-e2e.test.mjs`
- `node --test scripts/native-android-hosted-e2e.test.mjs`
- Focused exact-owner lifecycle tests added for alias cleanup ordering and
  malformed/cross-owner failure.
- Names-only Vercel inspection showing no orphan alias and a subsequent
  candidate transition to `READY` before native dispatch.

## Outcome

- Retirement now validates every deployment and complete alias response before
  the first mutation, deletes aliases serially, and preserves the deployment
  when any alias deletion fails.
- Local proof: 44 native iOS controller tests, 23 shared Android controller
  tests, and focused pagination/ordering cases passed.
- Review proof: preliminary specialists returned one accepted pagination
  finding; final ReviewGPT round 2 passed the corrected exact head with zero
  findings. Required GitHub checks passed on that head and the current-base
  merge tree was clean.
- Runtime proof: the dedicated alias was absent before the next run; the next
  candidate reached `READY`, acquired the expected alias, and dispatched the
  exact v9 Android source. No manual provider deletion was needed.
Completed: 2026-08-22
