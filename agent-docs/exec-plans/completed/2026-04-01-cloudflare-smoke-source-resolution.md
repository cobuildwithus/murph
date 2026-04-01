# Fix Cloudflare deploy smoke-step workspace source resolution

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Make the hosted deploy smoke script resolve workspace package imports from source in CI so the post-deploy health check can run after a successful Worker rollout.

## Success criteria

- `pnpm --dir apps/cloudflare deploy:smoke` no longer fails immediately with `ERR_MODULE_NOT_FOUND` for `@murph/hosted-execution/dist/index.js`.
- The fix stays within the smoke-step invocation surface and does not change hosted runtime behavior.
- A rerun of `deploy-cloudflare-hosted.yml` gets past both `Roll out Worker` and `Smoke test deployed endpoints`, or any new failure is clearly later and unrelated.

## Scope

- In scope:
- Narrow source-resolution fix for the Cloudflare deploy smoke script.
- Focused verification of the smoke script and a rerun of the deploy workflow.
- Out of scope:
- Broad tsx script normalization across the repo.
- Hosted runtime behavior changes.

## Constraints

- Keep the change limited to the smoke-step execution path.
- Preserve workspace package boundary rules by continuing to import public package names.

## Risks and mitigations

1. Risk: A tsconfig override could affect other app scripts if applied too broadly.
   Mitigation: Keep the fix scoped to the smoke command unless wider coverage is clearly necessary.

## Tasks

1. Patch the smoke command so tsx uses the Cloudflare app tsconfig for workspace path resolution.
2. Verify the smoke script reaches runtime/network execution instead of failing on module resolution.
3. Push the fix and rerun the production deploy workflow.

## Decisions

- Scope the fix to the `deploy:smoke` package script by passing `--tsconfig apps/cloudflare/tsconfig.json` to `tsx`, instead of broadening the change across every Cloudflare script.

## Verification

- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL=http://127.0.0.1:9 pnpm --dir apps/cloudflare deploy:smoke`
- Result: the smoke script reached `fetch()` inside `assertHealth()` and failed at the network boundary instead of crashing on `@murph/hosted-execution/dist/index.js` resolution.
- `pnpm --dir apps/cloudflare test:workers`
- `pnpm --dir apps/cloudflare verify` remains blocked by unrelated existing `packages/assistant-core` type errors on current `main`.
Completed: 2026-04-01
