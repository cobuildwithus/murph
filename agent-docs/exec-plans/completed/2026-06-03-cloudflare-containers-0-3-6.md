# Cloudflare Containers 0.3.6 Update

## Goal

Update the hosted Cloudflare runner from `@cloudflare/containers` `0.3.3`
to the latest published `0.3.6` release.

## Success Criteria

- `apps/cloudflare/package.json` depends on `@cloudflare/containers` `^0.3.6`.
- `pnpm-lock.yaml` resolves `@cloudflare/containers` to `0.3.6`.
- Dependency guard/audit checks run for the manifest and lockfile change.
- The Cloudflare runner verification lane runs, or any blocker is proven
  unrelated to this dependency-only diff.
- No runtime code, deployment config, or durable docs are changed unless
  verification proves the dependency update requires it.

## Scope

- `apps/cloudflare/package.json`
- `pnpm-lock.yaml`

## Current State

- Repo currently declares `@cloudflare/containers` `^0.3.3` and the lockfile
  resolves `0.3.3`.
- npm metadata shows `0.3.6` as the latest published version.
- The working tree already contains unrelated active Cloudflare and hosted-local
  changes; preserve them and keep this update to dependency hunks only.

## Verification Plan

- `pnpm deps:guard`
- `pnpm deps:audit`
- `pnpm deps:ignored-builds`
- `pnpm --dir apps/cloudflare verify`

## Verification Results

- `pnpm install --lockfile-only --frozen-lockfile` passed.
- `pnpm deps:guard` passed.
- `pnpm deps:ignored-builds` passed; no `node_modules` was present, so ignored
  builds could not be identified.
- `pnpm --dir apps/cloudflare verify` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/package.json pnpm-lock.yaml`
  passed; the lockfile root change broadened the lane to the workspace affected
  set.
- `pnpm deps:audit` remained red on unrelated existing `apps/web` transitive
  advisories through Privy/x402 paths. The updated `@cloudflare/containers`
  package has no runtime dependencies and was not in the audit paths.

## Notes

- This is a dependency-only change. Do not alter the hosted runner runtime
  architecture or active lifecycle-simplification work as part of this plan.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
