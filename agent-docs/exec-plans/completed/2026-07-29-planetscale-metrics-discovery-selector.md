# PlanetScale metrics discovery selector remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

Make the pending production database-health monitor select the exact
PlanetScale metrics target returned by the live Postgres Prometheus discovery
contract before its first deployment.

## Evidence

- The authenticated production discovery response returns organization,
  database-name, and branch-name labels, but no branch-ID label.
- The organization has more than one database with a production branch named
  `main`, so branch name alone is not an unambiguous selector.
- The selected metrics payload still labels every required series with the
  PlanetScale branch ID, so that ID remains the correct parser filter.
- PlanetScale accepts `read_metrics_endpoints` only as an organization-level
  service-token permission.

## Tasks

1. Add database-name and branch-name vars to the Worker and production deploy
   contract while retaining branch ID for metric-series filtering.
2. Resolve exactly one discovery group by database and branch name, then keep
   failing closed on missing or ambiguous targets.
3. Update focused fixtures, deploy tests, and rollout documentation.
4. Run focused tests, canonical verification, and the protected PR review
   gates; stage the validated production selector and credential contract
   before deployment.

## Constraints

- Keep PlanetScale and Linq credentials Worker-only.
- Do not store or log the alert recipient's phone number.
- Do not weaken the existing bounded target validation, redirect rejection, or
  required-metric checks.
- Deploy Cloudflare only after the protected production environment contains
  the complete validated contract.

## Result

- The Worker resolves exactly one live Prometheus scrape target by
  organization, database name, and branch name, then filters every metric
  series by the configured PlanetScale branch ID.
- Production contains the dedicated metrics-reader credential and all four
  PlanetScale selector fields. A credential-safe live probe selected one
  target and parsed every required metric family into a healthy snapshot.
- Focused node tests, the real Workers-runtime SQLite scheduled test,
  Cloudflare typecheck, and the canonical merged-head diff suite passed.
- The full acceptance suite completed with one unrelated concurrent setup
  wizard TTY race; the exact setup package then passed all 124 coverage tests
  in isolation.
- Linq delivery remains disabled until the existing direct conversation ID is
  installed. Deployment and the first scheduled healthy-sample check are
  operational follow-through after the protected PR lands.
Completed: 2026-07-29
