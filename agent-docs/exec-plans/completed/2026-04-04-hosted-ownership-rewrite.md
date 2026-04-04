# 2026-04-04 Hosted Ownership Rewrite

## Goal

Land the supplied `hosted-ownership-rewrite-clean.patch` fully against the current repo state, preserving the current dirty worktree while completing the hosted ownership/control rewrite across `apps/web`, `apps/cloudflare`, `packages/hosted-execution`, `packages/runtime-state`, and `packages/assistant-runtime`.

## Scope

- Supplied patch: `/Users/willhay/Downloads/hosted-ownership-rewrite-clean.patch`
- Hosted runtime/control/storage surfaces under `apps/cloudflare/**`
- Hosted control-plane publishing and remaining dead-route removal under `apps/web/**`
- Shared hosted execution/runtime contracts under `packages/{hosted-execution,runtime-state,assistant-runtime}/**`
- Durable docs only where the landed behavior changes repo truth

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated dirty-tree edits already present in hosted-share, Prisma, Cloudflare docs/tests, and any overlapping hosted files.
- Keep secrets and personal identifiers out of output, diffs, fixtures, and docs.
- Run the repo-required verification for touched surfaces plus the required final audit pass.

## Plan

1. Inspect the supplied patch against the current tree and classify each hunk as already-landed, still-missing, or conflicting with newer repo state.
2. Port the still-missing behavior onto the current files without reverting overlapping local work.
3. Update durable docs when the landed behavior changes the repo's documented hosted-runtime truth.
4. Run required verification and at least one direct scenario check for the hosted control/storage rewrite.
5. Run the required final completion audit, address findings, then close the plan and create a scoped commit.

## Progress

- Done: loaded the always-read repo docs plus the high-risk workflow, security, and reliability docs.
- Done: confirmed the patch path supplied by the user and the presence of overlapping local hosted-share/Cloudflare edits in the worktree.
- Done: ported the remaining hosted ownership rewrite across `apps/web`, `apps/cloudflare`, `packages/hosted-execution`, `packages/runtime-state`, and `packages/assistant-runtime`, including the worker-owned share/device-sync/usage/key mirrors and the signed control-path updates.
- Done: removed all patch reject artifacts after reconciling the rejected hunks into the live files.
- Done: verification passed for the touched surfaces:
  - `./node_modules/.bin/vitest run --config apps/cloudflare/vitest.config.ts`
  - `./node_modules/.bin/tsc --pretty false --noEmit -p apps/cloudflare/tsconfig.json`
  - `./node_modules/.bin/vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-browser-user-keys.test.ts apps/web/test/hosted-execution-control.test.ts apps/web/test/hosted-execution-hydration.test.ts apps/web/test/hosted-execution-outbox-payload.test.ts apps/web/test/hosted-execution-outbox.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-share-service.test.ts`
  - `./node_modules/.bin/tsc --pretty false --noEmit -p apps/web/tsconfig.json`
  - `./node_modules/.bin/vitest run --coverage.enabled false packages/hosted-execution/test/hosted-execution.test.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts`
  - `./node_modules/.bin/tsc --pretty false --noEmit -p packages/hosted-execution/tsconfig.json`
  - `./node_modules/.bin/tsc --pretty false --noEmit -p packages/assistant-runtime/tsconfig.json`
  - `./node_modules/.bin/tsc --pretty false --noEmit -p packages/runtime-state/tsconfig.json`
- Done: direct scenario proof succeeded with `./node_modules/.bin/tsx --eval ...`, confirming a browser-generated hosted root-key envelope unwraps successfully for both the automation recipient and the browser `user-unlock` recipient.
- Now: run the required final completion audit and address any findings.
- Next: close the plan, remove the coordination ledger row, and create the scoped commit.

Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
