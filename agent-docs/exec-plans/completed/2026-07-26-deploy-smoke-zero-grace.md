# Deploy Smoke Zero-Grace Rollout

## Goal

Let the isolated deploy-smoke container move to a newly deployed image without its
own probes extending the old image's rollout grace, while preserving the production
runner's shutdown window.

## Background

Production deploy run `30185788600` deployed the Worker and production runner image,
then failed its post-deploy smoke after 45 fresh-container attempts over 20 minutes.
Every attempt returned the immediately preceding deploy's bundle. The production
runner application reached the new image with healthy current-version instances,
while the one-instance deploy-smoke application remained on its old active revision.

The generated config applies `rollout_active_grace_period: 300` to both container
applications. Cloudflare documents that an immediate rollout still honors this
grace. That window protects user work in `RunnerContainer`, but the isolated
`DeploySmokeRunnerContainer` carries no user work and is created only to validate a
deploy. Repeated cold-start probes can therefore keep the only smoke slot active on
the old revision for a grace period that has no product purpose.

## Scope

- `apps/cloudflare/scripts/deploy-automation/wrangler-config.ts`
- `apps/cloudflare/wrangler.jsonc`
- focused deploy-automation tests
- `apps/cloudflare/DEPLOY.md`

## Constraints

- Keep the production `RunnerContainer` grace at 300 seconds.
- Keep the smoke rollout at one 100% step and retain all bundle, direct-R2, and live
  model assertions.
- Add no persisted state, polling service, queue, manager, or new dependency.
- Keep generated and checked-in Wrangler configuration aligned.

## Plan

1. Make rollout grace an explicit per-container input in the existing config helper.
2. Pass 300 seconds for `RunnerContainer` and zero for the disposable
   `DeploySmokeRunnerContainer`.
3. Mirror the contract in the checked-in Wrangler config.
4. Add focused assertions proving the production and smoke grace values cannot
   collapse back together.
5. Document why the smoke container intentionally uses the platform's zero-grace
   default behavior.

## Verification

- Focused deploy-automation tests.
- Cloudflare typecheck and docs drift checks.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- Exact-head CI and final cross-cutting review before merge.

Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
