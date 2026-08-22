# Prove Vercel production convergence

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Make the protected Web release gate reject a current-main deployment unless
  every configured production custom domain serves the exact ready deployment.
- Fail closed when the event, deployment, project, commit, or domain bindings do
  not agree.

## Success criteria

- The release gate resolves the immutable deployment from Vercel's GitHub
  deployment event and proves its production target, project, and exact Git SHA.
- Only the current protected `main` tip is required to be current; late events
  for older main ancestors remain safe no-op migration candidates.
- The gate independently proves every production project domain resolves to the
  exact deployment id before downstream release work succeeds.
- The configured production base host is present in that enumerated production
  domain set.
- The first production deployment containing the exact verifier is documented
  as the postdeploy rollback floor, with pre-floor failure proven before
  database authority and a floor-or-newer success path.
- Focused tests, typecheck, required audits, exact-head CI, and ReviewGPT pass.

## Scope

- Hosted Web Vercel release helper and focused deployment-guard tests.
- The protected post-deploy workflow that currently consumes Vercel's
  `deployment_status` event.
- Durable Web deployment, reliability, security, and CI ownership docs.

## Constraints

- Do not expose Vercel credentials, project identifiers, custom-domain names, or
  provider payloads in logs or artifacts.
- Keep promotion and rollback authority outside the public repository; this
  workflow verifies provider state and never mutates production routing.
- Preserve the existing prior-function drain and final commit proof before
  contract migrations.
- No production mutation is part of local implementation or PR verification.

## Tasks

1. Prove the stale-domain failure path and current production convergence using
   provider metadata only.
2. Add exact-deployment validation and complete production-domain verification.
3. Wire the protected workflow to the exact event URL with a current-main-tip
   fail-closed gate.
4. Add focused failure-path coverage and update durable deployment contracts.
5. Complete local verification, ReviewGPT, exact-head CI, merge, and post-merge
   live binding proof without triggering a production deploy.

## Evidence

- The existing workflow accepted Vercel's successful production event but
  resolved only one configured hostname after a drain; a mismatch skipped
  migrations instead of failing the release path.
- Vercel treats a ready deployment and the deployment currently receiving
  production-domain traffic as distinct release states; provider metadata must
  therefore prove both before downstream work succeeds.
- Current read-only provider inspection found five production project domains,
  all converged on the exact current deployment after the incident's explicit
  promotion.

## Completion evidence

- The focused production migration guard passes all 58 tests; hosted Web
  typechecking passes, and focused lint has zero errors with two unchanged
  pre-existing warnings in the shared test file.
- Preliminary specialists identified and the implementation resolved the final
  pre-SQL current-main classification gap and nested alias-URL canonicalization.
- The final ReviewGPT loop additionally resolved pnpm 10 lifecycle-stdout
  contamination and the deployed-tree verifier rollback floor; substantive
  round 4 returned `ROUND_OUTCOME: PASS` on the reviewed candidate.
- Exact-head pull-request evidence, host matrices, release build/typecheck,
  package coverage, app verification, bundle budget, billing, hygiene, viewport,
  foreground-state, and Vercel checks passed on the reviewed candidate.
- Plan archival is the only remaining candidate change before the final
  exact-head CI refresh and merge. The post-merge issue inventory and read-only
  binding proof remain required before handoff; neither step mutates production.
Completed: 2026-08-20
