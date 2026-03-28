# Cloudflare Hosted Runner

Status: completed
Created: 2026-03-26
Updated: 2026-03-28

## Goal

Add the first hosted execution layer for the SaaS shape: keep `apps/web` as the public onboarding/billing/auth control plane, and add a separate Cloudflare-hosted per-user runner that can hydrate hosted state, process active Linq messages plus scheduled assistant work with existing one-shot Murph runtime APIs, then write encrypted state back out.

## Scope

- Add a new `apps/cloudflare` workspace app for signed internal dispatch, per-user coordination, encrypted bundle storage, and one-shot runner contracts.
- Reuse existing `@murph/cli`, `@murph/inboxd`, and `@murph/runtime-state` seams instead of introducing a second assistant or inbox runtime model.
- Add bundle snapshot/restore helpers for the hosted execution context, including the canonical vault plus sibling assistant-state, with room for a future broader hosted agent-state bundle.
- Wire `apps/web` hosted onboarding to dispatch member-activation and active-member Linq events into the Cloudflare layer.
- Add focused tests, package wiring, and the minimum docs/env updates needed to keep verification and runtime docs truthful.

## Constraints

- Preserve the local-first vault format as canonical; the hosted runner must materialize a temporary local context rather than inventing a new canonical state model.
- Keep canonical health writes inside existing package boundaries; hosted orchestration may coordinate work but must not bypass `core`/`inboxd`/assistant package APIs.
- Treat `.runtime/` as rebuildable state by default; only include hosted runner-local state when it is immediately justified for behavior or performance.
- Do not touch the existing local-only `packages/web` surface.
- Keep the initial hosted runner honest about trust boundaries: encrypted-at-rest hosted bundles are acceptable, but this lane does not claim operator-blind privacy or TEE execution yet.

## Risks

1. Risk: Cloudflare Containers are beta and have ephemeral disk plus platform-specific APIs.
   Mitigation: keep the Worker/DO layer thin, put most behavior in plain TypeScript modules and a simple Node runner, and make the Cloudflare-specific layer mostly coordination and I/O glue.
2. Risk: hosted execution could duplicate the existing inbox/assistant loops.
   Mitigation: reuse `normalizeLinqWebhookEvent`, `createInboxPipeline`, `rebuildRuntimeFromVault`, `createIntegratedInboxCliServices`, and `runAssistantAutomation({ once: true })`.
3. Risk: bundle snapshotting could accidentally drag in sensitive or purely local residue.
   Mitigation: snapshot explicit roots only, exclude `.env*` and unrelated runtime artifacts, and keep bundle tests focused on the exact persisted tree.
4. Risk: hosted-web integration can collide with in-flight `apps/web` work.
   Mitigation: keep `apps/web` edits narrow and namespaced under a new hosted-execution helper surface.

## Verification Plan

- Focused: `pnpm --dir apps/cloudflare typecheck`, `pnpm --dir apps/cloudflare test`
- Focused: `pnpm --dir apps/web typecheck`, targeted `apps/web` Vitest coverage for the new dispatch hooks
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Completion workflow audit passes because this touches production code and trust-boundary documentation.

## Outcome

- Added `apps/cloudflare` for signed internal dispatch, per-user Durable Object coordination, encrypted hosted bundle storage, and a one-shot hosted runner that reuses the existing inbox plus assistant runtime seams.
- Added shared hosted bundle snapshot/restore and execution-contract helpers under `packages/runtime-state`.
- Wired `apps/web` hosted onboarding so active members dispatch activation and Linq message events into the hosted runner path.
- Updated repo verification/docs wiring so `apps/cloudflare` is part of the truthful local verification surface.

## Verification Notes

- Focused checks passed:
  - `pnpm --dir packages/runtime-state typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/hosted-execution-env.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
  - `pnpm --dir apps/cloudflare test`
- Required repo checks were run and exposed pre-existing failures outside this lane:
  - `pnpm typecheck` failed in `packages/contracts/scripts/{generate-json-schema.ts,verify.ts}` with unresolved `@murph/contracts` imports and implicit-`any` script errors.
  - `pnpm test` surfaced failures in `packages/cli/test/incur-smoke.test.ts` and did not produce a clean repo-wide green result.
  - `pnpm test:coverage` surfaced failures in `packages/cli/test/incur-smoke.test.ts` and did not produce a clean repo-wide green result.
- Manual direct-scenario gap: a standalone source-level worker smoke was attempted, but running `apps/cloudflare/src/*` outside the Vitest alias context could not resolve the workspace `@murph/runtime-state` package from raw source. Focused app-boundary tests are green, but a live/manual hosted runtime proof is still outstanding.
Completed: 2026-03-28
