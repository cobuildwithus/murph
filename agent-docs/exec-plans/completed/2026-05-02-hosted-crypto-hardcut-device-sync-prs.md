# Hosted Crypto Hard-Cut Remaining PRs

## Goal

Land the supplied remaining PR 5-9 patch against current `main` without disturbing unrelated active Health Commons or hosted onboarding work.

Success criteria:

- Cloudflare/local-dev legacy platform-envelope and wake/web encryption scaffolding is removed.
- The hosted crypto hard-cut guard no longer allows the Cloudflare mailbox legacy shim as a runtime exception.
- Hosted Cloudflare object paths for bundles, artifacts, runner secrets, and browser-vault replicas are stable per-user namespaces independent of encryption roots.
- Bundle path detection and GC naming use runtime-root terminology instead of platform-envelope terminology.
- Hosted secure-box decrypts by stored `rootKeyId` and web unwrap paths fail closed unless domain roots already exist.
- Focused tests and required repo checks/audits are run or blockers are recorded.

## Scope

- `apps/cloudflare/.dev.vars.example`
- `apps/cloudflare/src/{hosted-mailbox-encryption,storage-paths,bundle-store,bundle-gc}.ts`
- `apps/cloudflare/test/{storage-paths,storage-path-rotation,index}.test.ts`
- `apps/web/src/lib/hosted-crypto/{domain-root-store,secure-box}.ts`
- `apps/web/test/hosted-crypto-domain-root-store.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- `scripts/check-hosted-crypto-hardcut.mjs`
- `scripts/dev-hosted-local/{constants,environment}.ts`

## Constraints

- Preserve unrelated dirty Health Commons/experiments work.
- Do not reintroduce legacy hosted wake/web encryption env paths or Cloudflare platform-envelope runtime exceptions.
- Normal hosted web unwrap paths must not lazily provision domain roots except through explicit activation/provisioning flows.
- No dependency changes.

## Verification Plan

- `node scripts/check-hosted-crypto-hardcut.mjs`
- Focused Vitest for hosted crypto domain-root store and Cloudflare storage-path behavior.
- `pnpm typecheck`
- `pnpm test:diff <touched paths>` if it can truthfully cover this patch in the dirty tree; otherwise record blocker and run focused owner checks.
- Required completion-workflow audits: `security-privacy-review`, `coverage-write`, `task-finish-review`.

## State

- 2026-05-02: Supplied patch does not apply cleanly to `scripts/check-hosted-crypto-hardcut.mjs` and `apps/web/src/lib/hosted-crypto/domain-root-store.ts`; clean hunks will be applied and drifted hunks ported manually.
- 2026-05-02: Current branch already contained most source hunks; landed remaining stale test updates and tightened assistant-runtime child/user env sanitizers for legacy `HOSTED_WEB_ENCRYPTION_*` keys after security review.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
