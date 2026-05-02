# Device-sync env placeholder hard cut

## Goal

Remove legacy `DEVICE_SYNC_ENCRYPTION_KEY*` CI placeholders from GitHub workflows and make the hosted crypto hard-cut guard catch those stale env names in workflow/env-manifest surfaces.

Success criteria:
- `.github/workflows/release.yml`, `.github/workflows/host-support.yml`, and `.github/workflows/cloudflare-hosted-e2e.yml` use `HOSTED_DEVICE_ROUTING_INDEX_KEY` plus `HOSTED_MAILBOX_FINGERPRINT_KEY`.
- No workflow env block keeps `DEVICE_SYNC_ENCRYPTION_KEY` or `DEVICE_SYNC_ENCRYPTION_KEY_VERSION`.
- Guard coverage scans `.github/workflows`, app `.env.example` files, deploy docs, and local harness env template surfaces for removed hosted crypto env names.
- Focused workflow guard tests and hosted crypto guard pass.

## Constraints

- Preserve unrelated active rows and dirty files.
- Do not touch historical completed-plan snapshots.
- Do not weaken the app runtime fail-closed behavior that rejects the legacy names.

## Implementation Notes

- Keep deterministic placeholder key values only; do not introduce real secrets.
- Update durable testing/verification docs if their CI workflow descriptions name the removed placeholders.

## Verification

- Passed: `node --check scripts/check-hosted-crypto-hardcut.mjs`.
- Passed: `pnpm hosted-crypto:guard`.
- Passed: workflow YAML parse for `release`, `host-support`, and `cloudflare-hosted-e2e`.
- Passed: focused CLI workflow guard Vitest files for release, host-support, and Cloudflare hosted E2E.
- Passed: stale-name `rg` over workflows, env examples, deploy docs, hosted web README, and local harness env surfaces.
- Passed: `git diff --check` for touched paths.
- Security/privacy review found two guard issues: env-token failure output could echo values, and the guard omitted the hosted web README env manifest. Both were fixed.
- Blocked unrelated: scoped `test:diff` failed in `scripts/research-init.test.ts` on an unrelated Health Commons zip-entry expectation.
- Blocked unrelated: root `pnpm typecheck` failed in `apps/web/test/hosted-account-data-service.test.ts` on a pre-existing `field` property type error outside this lane.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
