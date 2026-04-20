## Goal

Align Cloudflare hosted-runner defaults with the intended custom container shape and raise the default instance ceiling to 1000 across checked-in config, deploy automation, workflow defaults, docs, and tests.

## Why

- The checked-in Wrangler scaffold still uses `standard-1` and `max_instances: 50`.
- The deploy workflow and docs still describe the old defaults.
- Deploy automation already supports custom JSON container shapes, so the repo can carry the intended shape directly.

## Scope

- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/scripts/deploy-automation/{environment,wrangler-config}.ts`
- `apps/cloudflare/test/{deploy-automation,container-image-contract}.test.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/DEPLOY.md`

## Verification plan

- `pnpm --dir apps/cloudflare test -- --runInBand deploy-automation.test.ts container-image-contract.test.ts`
- `pnpm --dir apps/cloudflare typecheck`

## Notes

- Keep the change limited to config/defaults/docs/tests.
- Treat existing GitHub environment vars as authoritative overrides; document the exact vars that must be updated if they are already set remotely.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
