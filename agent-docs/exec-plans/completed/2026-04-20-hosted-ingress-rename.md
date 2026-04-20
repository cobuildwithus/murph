# Rename hosted wake ledger and public wake controls to hosted ingress/run terminology

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Hard-cut the external hosted execution ledger and public control helpers to ingress/run terminology so web-owned ingress facts are clearly separated from runtime-local follow-up work.

## Success criteria

- Shared hosted contracts no longer export the greenfield surfaces under `HostedWake*` / `HostedExecutionWake*` names where the new ingress/run names are intended to replace them.
- Web-owned queue/control code uses `hosted-ingress` naming and the internal Cloudflare control route uses `/internal/users/:userId/run`.
- Cloudflare public/control helpers expose `nudgeHostedRun` and `drainHostedRuns` instead of wake-shaped helper names.
- Directly coupled tests and live docs reflect the renamed ingress/run boundary without rewriting immutable historical plan artifacts.

## Scope

- In scope:
  - live code under `apps/web`, `apps/cloudflare`, `packages/hosted-execution`, and directly coupled tests
  - live docs that describe the current hosted ingress/run boundary
  - filesystem rename from `apps/web/src/lib/hosted-wake/` to `apps/web/src/lib/hosted-ingress/` if callers can be updated in the same slice
- Out of scope:
  - immutable completed execution plans under `agent-docs/exec-plans/completed/**`
  - unrelated hosted-run semantic changes already in flight
  - the newly landed fail-closed `runDrain` hard-cut in `packages/hosted-execution`, `packages/assistant-runtime`, and overlapping Cloudflare runtime parser/finalize code
  - broad renames for internal runtime-only `HostedExecutionWake` concepts beyond the requested greenfield ingress/runtime boundary cuts if they would force a larger architecture rewrite in this slice

## Constraints

- Technical constraints:
  - Preserve existing behavior and integrate on top of the current dirty-tree hosted-run / hosted-wake edits.
  - Keep sibling package imports on public entrypoints only.
  - Do not weaken fetch-proof, CAS, or finalize recovery invariants while renaming.
- Product/process constraints:
  - Treat this as a greenfield-shape cleanup for live surfaces, not a history rewrite.
  - Update durable docs when the architecture naming changes.

## Risks and mitigations

1. Risk: overlapping hosted-run edits already touch the same owners.
   Mitigation: keep the rename narrow, re-read touched files before each patch, and avoid reverting unrelated hunks.
2. Risk: route/helper renames can silently break cross-app call sites.
   Mitigation: inventory every live caller before renaming and run diff-aware verification plus focused tests after the patch.
3. Risk: mixed old/new terminology can leave the boundary less clear than before.
   Mitigation: update shared contract names, route builders, and live protocol docs in one slice.

## Tasks

1. Fill the active plan/ledger metadata and inventory live hosted-wake surfaces that should move to ingress/run naming.
2. Rename shared hosted-execution contract types/builders/parsers and the web-owned `hosted-wake` module surface to `hosted-ingress`.
3. Rename Cloudflare helper methods and internal routes from wake-shaped control names to run-shaped control names.
4. Update directly coupled tests and live docs, then run verification, required audits, and the repo finish flow.

## Decisions

- Preserve immutable completed plan artifacts and historical docs unless they are part of the live architecture surface.
- Prefer `HostedIngressEventReceipt` over `HostedIngressEventAlias` if the old `HostedWakeEvent` name is still needed as a distinct public type after inspecting current usage.
- Keep mixed runner/request hard-cut files out of this lane even when they still contain internal `wake` helper names; only live ingress/run boundary surfaces move here.

## Verification

- Commands to run:
  - `pnpm exec prisma generate` (from `apps/web`)
  - `pnpm typecheck` (from `apps/web`)
  - `pnpm exec vitest run apps/web/test/hosted-ingress-payload.test.ts apps/web/test/hosted-ingress-payload-unification.test.ts apps/web/test/hosted-ingress-store-data.test.ts apps/web/test/hosted-ingress-queue.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-share-acceptance-lifecycle.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  - `pnpm exec vitest run --config vitest.node.workspace.ts --no-coverage test/index.test.ts test/hosted-email-worker-ingress.test.ts` (from `apps/cloudflare`)
  - `pnpm typecheck` (from `apps/cloudflare`)
  - `pnpm exec tsc -p tsconfig.json --noEmit` (from `packages/cloudflare-hosted-control`)
  - `pnpm exec vitest run test/client.test.ts test/routes.test.ts --no-coverage` (from `packages/cloudflare-hosted-control`)
  - `git diff --check -- <scoped ingress/run files>`
- Expected outcomes:
  - Renamed ingress/run surfaces typecheck and the touched owner tests pass without reintroducing wake-shaped public helpers on the live path.
Completed: 2026-04-20
