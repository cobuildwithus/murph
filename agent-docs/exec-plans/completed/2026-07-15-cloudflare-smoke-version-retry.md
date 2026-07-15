# Cloudflare smoke version retry

## Goal

Prevent successful Cloudflare Worker deployments from being marked failed when
the newly created version is briefly unavailable to version-override requests.

Success criteria:

- Retry only an otherwise-valid public smoke response whose Worker version does
  not yet match the deployed version.
- Keep HTTP, JSON, service identity, and `ok` failures immediate and explicit.
- Bound the retry window and cover both banner and health checks with focused
  tests.

## Constraints

- Add no dependency, service, persistent state, or deploy orchestrator.
- Preserve the existing managed-container retry policy and production smoke
  ordering.
- Keep logs metadata-only and avoid secrets or direct personal identifiers.

## Approach

1. Trace the smoke history and confirm the transient boundary.
2. Add one small bounded retry around exact Worker-version mismatches.
3. Add focused regression tests for recovery and hard failures.
4. Run scoped verification, required audits, and the PR review gate.

## State

Active.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
