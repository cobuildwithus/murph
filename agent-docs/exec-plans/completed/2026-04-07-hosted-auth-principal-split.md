# Split hosted auth by principal and remove the shared internal secret lane

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Finish the hosted auth seam by assigning one principal per route family, removing the long-lived shared `HOSTED_WEB_INTERNAL_SIGNING_SECRET` trust lane, and moving hosted share creation onto the normal user-authenticated web boundary.

## Success criteria

- `apps/web -> apps/cloudflare` keeps using Vercel OIDC only.
- Hosted web cron routes accept Vercel cron auth only and no longer depend on the hosted internal signing helper.
- Cloudflare-owned callbacks into `apps/web` verify an app-local asymmetric Cloudflare signer instead of a shared symmetric secret.
- Hosted share creation no longer uses the internal signed route and instead runs through a normal user-authenticated hosted web route.
- Shared `packages/hosted-execution` helpers no longer model one generic signed internal web principal spanning scheduler, Cloudflare, and assistant callers.
- Docs and env contracts describe the new principal split without stale shared-secret instructions.

## Scope

- In scope:
- `apps/web` hosted auth helpers, cron routes, Cloudflare callback routes, and hosted share creation route ownership
- `apps/cloudflare` callback signing helpers and env parsing for the new Cloudflare callback signer
- `packages/hosted-execution` helper cleanup where the old generic internal-signing seam is still modeled
- `packages/assistant-engine` hosted-share helper cleanup
- hosted docs and architecture updates
- Out of scope:
- changing the existing `apps/web -> apps/cloudflare` Vercel OIDC dispatch/control edge beyond keeping it intact
- redesigning the runner/container per-run control or proxy tokens
- introducing a dual-auth migration window

## Constraints

- Technical constraints:
- Route auth must be principal-specific and fail closed; no fallback generic "trusted server-to-server" verifier remains.
- Cloudflare callback signing must keep the existing request binding shape: method, path, query string, payload, bound user id, timestamp, and nonce.
- Existing replay protection on the hosted web callback lane must remain or improve.
- Product/process constraints:
- Hosted share creation should move to the normal authenticated hosted web boundary rather than a replacement internal signer lane.
- The cutover is greenfield; do not preserve compatibility for the old shared-secret auth paths.
- Preserve unrelated dirty-tree edits and re-read overlapping hosted files before changes.

## Risks and mitigations

1. Risk: auth logic sprawls across web, Cloudflare, shared helpers, and docs.
   Mitigation: cut the route principal map first, then replace each route family one by one before deleting the generic helper.
2. Risk: the shared hosted-execution package keeps encoding old assumptions after app-local auth moves.
   Mitigation: remove or narrow shared signing helpers in the same change instead of leaving stale abstractions behind.
3. Risk: hosted share creation loses a required internal caller path.
   Mitigation: move it directly onto a normal authenticated web route and remove the ambient assistant caller so share issuance only exists when an explicit user-authenticated capability is injected.

## Tasks

1. Register the coordination lane and map current callers/routes/envs for scheduler, Cloudflare callbacks, and hosted share creation.
2. Add route-specific auth helpers in `apps/web`: Vercel cron verification and Cloudflare callback verification.
3. Add Cloudflare asymmetric callback signing and remove the old shared-secret callback use.
4. Replace the internal hosted share creation route with a normal authenticated hosted web route and remove internal signed share issuers/callers.
5. Delete stale generic internal-signing helpers/envs/docs, run required verification plus direct scenario proof, complete the required audit pass, and commit with `scripts/finish-task`.

## Decisions

- Scheduler routes will use Vercel cron auth only.
- Cloudflare callback auth will use an app-local asymmetric signer rather than another shared symmetric secret.
- Hosted share creation will be user-authenticated web behavior, not an internal signed route.
- No dual-auth migration window is needed.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Expected outcomes:
- Hosted web and Cloudflare tests prove the new principal split, old shared-secret auth is removed, and user-authenticated share creation still works.
- Actual outcomes:
- `pnpm typecheck` failed in pre-existing unrelated files: `packages/core/src/mutations.ts`, `packages/core/src/vault.ts`, `packages/assistant-engine/src/usecases/integrated-services.ts`, `packages/assistant-engine/src/usecases/workout-measurement.ts`, `packages/assistant-engine/src/usecases/workout-model.ts`, and `packages/cli/src/commands/model.ts`.
- `pnpm test:coverage` failed at the same pre-existing workspace typecheck blockers before tests executed.
- `pnpm --dir apps/web lint` passed with pre-existing warnings only.
- Focused proof:
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-execution/internal.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/hosted-share-create-route.test.ts apps/web/test/hosted-share-import-complete-route.test.ts apps/web/test/hosted-share-import-release-route.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/env.test.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/user-env.test.ts`
- `pnpm exec vitest run --no-coverage packages/cli/test/inbox-model-harness.test.ts`
Completed: 2026-04-07
