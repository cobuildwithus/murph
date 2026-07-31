# Private Environment print report

## Goal

Restore the `Print report` action on `/environment` and render the report from
the signed-in member's current private Browser Vault data.

## Constraints

- `/environment/print` must require an authenticated hosted session.
- Reuse the Environment grading and coverage model; do not create a second
  source of truth for report values.
- Never put private Habitat values into metadata, public image routes, logs, or
  server-rendered fixtures.
- Keep the print view useful on screen and clean on paper.

## Working set

- `apps/web/app/(dashboard)/environment/**`
- `apps/web/app/environment/print/**`
- `apps/web/app/design/**`
- focused Environment tests and the Habitat product spec

## Verification plan

- Prove unauthenticated requests are redirected before the print client mounts.
- Prove the report derives its visible facts from Browser Vault values.
- Run focused Environment tests, changed-file lint, hosted-web typecheck, and
  desktop/mobile design-catalog proof.
