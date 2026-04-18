## Goal

Get the hosted local Cloudflare e2e suite back to green and keep the fix scoped to the failing local e2e harness or behavior under test.

## Scope

- `apps/cloudflare/**`
- any directly implicated shared package files only if the failing e2e root cause is outside the app-local harness

## Constraints

- Preserve unrelated in-flight work, especially existing root manifest edits.
- Prefer the smallest fix that restores truthful local e2e behavior.
- Avoid broad hosted-runtime refactors unless the failure proves they are necessary.

## Verification

- targeted hosted local e2e command(s) covering the failing scenario
- required repo verification for touched owners per repo policy
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
