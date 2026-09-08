# Prepare Worker workspace artifacts before hosted-local snapshots

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Hosted-local Worker snapshots must not silently copy stale public workspace artifacts when runner-bundle preparation is skipped.

## Success criteria

- Prove the actual snapshot owner copies a stale synthetic module before correction.
- Reuse existing declared package builds or an existing artifact owner to prepare the bounded Worker dependency closure before copying, with build failure/cancellation preventing Worker launch.
- Preserve no-bundle runner reuse, production deployment validation and local process ownership.
- Focused red/green proof, proportional typecheck/audits, full exact-head ReviewGPT and required CI before landing.

## Scope

Local Worker snapshot preparation and focused tests/owner documentation only. No production validators, new fingerprint/cache state, dependencies, real credentials, Docker, or unrelated lifecycle edits.

## Evidence and decisions

- Committed issue2717 authority is unique on main; static trace proves the existing materializer checks only dist-directory existence before copying. Current standalone owner is private inside stack.ts.
- Actual public stack diagnostic reproduced copying a stale synthetic dist module. The initial per-stack build prototype fixed that diagnostic but would repeat work across scenario groups; it was removed before the intended candidate.
- Public --no-bundle exists only on e2e CLI and maps to prepareRunnerBundle=false. The final correction uses existing suite preparation once before scenarios, with native pnpm --filter-prod dependency selection and existing foreground process/cancellation owners. Normal standalone up still builds the bundle; raw internal skip-bundle callers continue to supply prepared artifacts.
- The final actual-suite regression independently fails at HEAD when stale source reaches scenario admission, and passes after declared synthetic pnpm builds. It proves transitive ordering, excludes Worker/dev-only/unrelated packages, and invokes preparation only once for multiple scenario batches.
- The current Worker production dependency closure has 20 packages. Native declared builds avoid a second timestamp/hash freshness mechanism, exclude unrelated packages and reuse the existing concurrency setting. No production manifest/validator or snapshot/lifecycle source changes remain.

## Tasks

1. Establish dynamic stale-copy regression with actual materialization.
2. Choose and implement the smallest existing-owner correction; cover build failure and cancellation.
3. Run focused proof, typecheck and audits; update owner docs.
4. Commit scoped candidate, launch full review concurrent CI, disposition findings and finish exact-head gates.

## Verification

- Actual stack diagnostic: one stale-copy regression failed before correction; no stack prototype remains in the final patch.
- Final suite regression: failed against unchanged HEAD (stale export before scenario admission), then passed with native declared synthetic builds, transitive order and exclusion controls.
- E2E suite and CLI: 56 passed. Actual foreground/process integration: 2 passed isolated; one cold parallel run hit the unchanged MinIO readiness bound before the isolated pass. No timeout or cleanup behavior changed.
- Harness typecheck passed. Complexity guard passed: debt 0 to 0, maximum 13 unchanged, no hotspot above 20. Documentation drift and whitespace passed.
- External full ReviewGPT, exact-head CI, and actual merge/closure proof remain completion gates tracked in the PR and automation evidence.
Completed: 2026-09-05
