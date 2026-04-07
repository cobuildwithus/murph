# Shrink hosted-execution to a narrow seam

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Reduce `@murphai/hosted-execution` to the transport-neutral hosted seam: shared dispatch/control contracts, stable route shapes, parsers, and only the minimal generic helpers that still belong at that boundary.
- Move app-local hosted infra adapters out of the public seam package.
- Move subsystem-owned hosted contracts out of `@murphai/hosted-execution` and into their actual owners.

## Success criteria

- `packages/hosted-execution/src/index.ts` exports only the narrow hosted seam surface and stops re-exporting app-local env/auth/callback/client/control helpers.
- Hosted device-sync runtime request/response types and parsers move to `@murphai/device-syncd`.
- Hosted usage export, hosted share-pack control, hosted member-private-state control, and hosted user-env control no longer originate from `@murphai/hosted-execution`.
- `apps/web`, `apps/cloudflare`, and `packages/assistant-runtime` consume the new owners without changing hosted behavior.
- Architecture/docs describe `@murphai/hosted-execution` as a narrow contract package rather than a grab-bag hosted owner.

## Scope

- In scope:
- `packages/hosted-execution/**`
- `packages/device-syncd/**`
- `packages/runtime-state/**`
- `packages/assistant-runtime/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-share/**`
- `apps/cloudflare/**`
- matching tests/docs needed to keep ownership and verification truthful
- Out of scope:
- behavior changes to hosted onboarding, hosted share semantics, or hosted device-sync flows beyond ownership movement
- new product capabilities or hosted protocol redesigns

## Constraints

- Preserve adjacent dirty-tree edits; this refactor overlaps active hosted lanes.
- Keep sibling-package imports on declared package entrypoints only.
- Avoid introducing new third-party dependencies.
- Keep the final `@murphai/hosted-execution` surface transport-neutral and small.

## Risks and mitigations

1. Risk: Route/path or parser ownership moves can silently drift caller/callee behavior.
   Mitigation: move shared types/parsers with the owner package and run focused tests on the moved seams.
2. Risk: Existing dirty-tree edits in hosted files can be clobbered during the refactor.
   Mitigation: re-read touched files before each edit and keep patches narrowly scoped.
3. Risk: Public-package export changes break internal workspace consumers.
   Mitigation: update every import site in-tree in the same turn and keep the remaining seam package coherent.

## Tasks

1. Register the ledger lane and inspect the current hosted-execution export/import surface.
2. Move hosted device-sync runtime contracts/parsers/routes to `@murphai/device-syncd`.
3. Re-home hosted usage/share/member-state/user-env adapters to local or owning package surfaces.
4. Trim `@murphai/hosted-execution` exports, package docs, and architecture wording to the new narrow seam.
5. Run required verification, complete the required audit pass, and close/commit the plan.

## Decisions

- Prefer existing owner packages plus app-local adapters over adding another generic hosted helper package.
- Keep `@murphai/hosted-execution` focused on shared dispatch/auth/route/outbox/seam contracts, not Cloudflare or Vercel deployment wiring.

## Verification

- Commands to run:
- `./node_modules/.bin/tsc -p packages/hosted-execution/tsconfig.json --noEmit --pretty false`
- `./node_modules/.bin/tsc -p packages/assistant-runtime/tsconfig.json --noEmit --pretty false`
- `./node_modules/.bin/tsc -p packages/assistant-engine/tsconfig.json --noEmit --pretty false`
- `./node_modules/.bin/tsc -p apps/cloudflare/tsconfig.json --noEmit --pretty false`
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false`
- `../../node_modules/.bin/vitest run --config vitest.config.ts test/hosted-share-issuer.test.ts test/member-private-state.test.ts test/hosted-execution.test.ts` from `packages/hosted-execution`
- `../../node_modules/.bin/vitest run --config vitest.config.ts test/hosted-runtime-usage.test.ts test/hosted-runtime-http.test.ts` from `packages/assistant-runtime`
- `../../node_modules/.bin/vitest run --config vitest.config.ts test/execution-adapters.test.ts` from `packages/assistant-engine`
- `./node_modules/.bin/vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/business-outcomes.test.ts`
- `./node_modules/.bin/vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-control.test.ts`
- Expected outcomes:
- Passed:
- `packages/hosted-execution` typecheck
- `packages/assistant-runtime` typecheck
- `packages/assistant-engine` typecheck
- `apps/cloudflare` typecheck
- targeted hosted seam tests listed above
- Unrelated blocker:
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false`
- failure: `apps/web/src/lib/hosted-onboarding/invite-service.ts(179,59)` rejects `TransactionClient | PrismaClient` where `PrismaClient` is required
- this file was already dirty outside the seam-split edits and was not changed as part of the narrow-seam refactor
Completed: 2026-04-07
