# Cloudflare staging follow-ups

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Close the remaining pre-staging deploy/config hygiene gaps for the Cloudflare hosted runner without changing the hosted execution architecture or disabling hosted device-sync in this pass.

## Overlap check

Already fixed in the live tree before this lane:

- root `Dockerfile.cloudflare-hosted-runner` exists again
- root `.dockerignore` exists again
- `pnpm-lock.yaml` exists, so CI can keep using `pnpm install --frozen-lockfile`
- root `.gitignore` already ignores `.next-dev/`
- `CF_PUBLIC_BASE_URL` is already threaded into the deploy workflow env
- transient R2 object keys already use top-level `transient/...` prefixes

Still missing for this lane:

- explicit Wrangler `secrets.required` coverage in both checked-in and generated config
- an early deploy-workflow failure with a clear message when `CF_PUBLIC_BASE_URL` is unset
- a repo-owned R2 lifecycle rule artifact plus docs/script wiring for `transient/execution-journal/` and `transient/side-effects/`
- local cleanup of the current ignored `apps/web/.next-dev` dev artifact directory

Explicitly out of scope:

- disabling hosted device-sync for v1

## Scope

- `apps/cloudflare/{wrangler.jsonc,README.md,DEPLOY.md,package.json}`
- `apps/cloudflare/src/deploy-automation.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- repo docs that describe truthful deploy/runtime verification
- cleanup of the ignored local `apps/web/.next-dev` directory

## Constraints

- Preserve adjacent dirty hosted Cloudflare and hosted web work.
- Keep the Cloudflare-native Worker + Durable Object + Container architecture unchanged.
- Use the current Cloudflare-supported lifecycle path: bucket lifecycle rules are managed outside worker `wrangler.jsonc`.
- Keep the change truthful about `secrets.required` being experimental in Wrangler docs.

## Verification

- Focused `apps/cloudflare` tests while iterating.
- Required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audits after functional verification:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Progress

- Done:
  - checked active execution plans and the live worktree for overlap with the requested review list
  - confirmed the deploy-file, lockfile, `.next-dev` ignore, `CF_PUBLIC_BASE_URL` wiring, and transient-prefix items are already present
  - patched deploy config, workflow preflight, lifecycle-rule docs/artifacts, and local `.next-dev` cleanup
  - ran focused proof: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/deploy-automation.test.ts --no-coverage --maxWorkers 1`
  - ran direct scenario proof by rendering deploy config with sample env and confirming `secrets.required` is emitted
  - ran required repo checks and recorded current outcomes
  - completed required spawned audit passes for `simplify`, `test-coverage-audit`, and `task-finish-review`
- Now:
  - commit the touched files and hand off the overlap summary plus verification status
- Next:
  - none
Completed: 2026-03-28
