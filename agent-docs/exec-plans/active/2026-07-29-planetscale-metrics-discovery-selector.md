# PlanetScale metrics discovery selector remediation

Status: active
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
4. Run focused tests, canonical verification, PR review gates, deploy, and
   confirm a healthy persisted sample without inducing a production failure.

## Constraints

- Keep PlanetScale and Linq credentials Worker-only.
- Do not store or log the alert recipient's phone number.
- Do not weaken the existing bounded target validation, redirect rejection, or
  required-metric checks.
- Deploy Cloudflare only after the protected production environment contains
  the complete validated contract.
