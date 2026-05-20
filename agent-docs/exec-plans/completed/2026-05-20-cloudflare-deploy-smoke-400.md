# Cloudflare Deploy Smoke 400

## Goal

Make the hosted Cloudflare deploy smoke resilient and diagnosable after the production deploy job returned an opaque runner-container HTTP 400 immediately after Worker rollout.

## Scope

- `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts`
- focused smoke deploy tests

## Constraints

- Do not rerun a deploy.
- Do not expose secrets, R2 signatures, account identifiers, local paths, or response bodies beyond short redacted diagnostics.
- Preserve existing GitHub environment/secret wiring.

## Verification Plan

- focused `apps/cloudflare/test/smoke-hosted-deploy.test.ts`
- focused Cloudflare typecheck if available

## Current State

- GitHub production R2 vars/secrets are present.
- The production Worker version has the expected R2 presign bindings.
- Local validation proved the repo presigner can PUT/delete a small object in the production bucket with the provided R2 credentials.
- The failed job hid the 400 response body; Cloudflare observability only shows the deploy-smoke container lifecycle starting, becoming ready, then being destroyed in the same window.
- Patched the smoke harness to retry runner-container HTTP 400 responses and include a short redacted failure body for terminal failures.
- Verification passed: Cloudflare node test workspace with the smoke deploy test filter, and `pnpm --dir apps/cloudflare typecheck`.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
