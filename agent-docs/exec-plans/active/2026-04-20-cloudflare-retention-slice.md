Status: in_progress
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Land the still-missing hosted Cloudflare retention/privacy fixes only for raw hosted email cleanup, R2 lifecycle backstop, and browser-vault snapshot sidecar deletion.

## Success criteria

- Hosted email ingress deletes the raw encrypted `.eml` object when the canonical web append fails after the raw write.
- The checked-in R2 lifecycle config adds a real hosted-email raw-message retention backstop without broadening lifecycle expiry to durable bundle data.
- Successful completed hosted runs delete stale browser-vault snapshot sidecars when no browser snapshot is returned, while preserving existing behavior when a snapshot is returned.

## Scope

- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/hosted-email.ts` only if required
- `apps/cloudflare/src/browser-vault-store.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- directly coupled Cloudflare tests/docs/lifecycle config only if required
- `apps/cloudflare/r2-bundles-lifecycle.json`

## Constraints

- Preserve overlapping dirty-tree edits already present in the Cloudflare hosted-email and runner files.
- Do not broaden into the larger browser-vault projection redesign.
- Do not use commit helpers or create commits.

## Verification

- planned: focused Cloudflare tests for hosted-email ingress, browser-vault store, runner-run-processor, and lifecycle config
- planned: focused Cloudflare typecheck or truthful diff-aware verification for the touched slice
- planned: `git diff --check`

## Notes

- The targeted hosted-email file already has overlapping dirty-tree log-redaction edits; layer the cleanup fix on top without disturbing them.
