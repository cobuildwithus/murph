# Hosted web Next follow-up

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Finish the hosted web artifact/source-resolution cleanup so review bundles include the shared config helper, interactive dev and automated dev smoke no longer share mutable Next output, hygiene scanners treat every hosted Next artifact directory consistently, and clean typecheck does not rely on stale route-type leftovers.

## Success criteria

- `pnpm zip:src` includes `config/workspace-source-resolution.ts`.
- Interactive `apps/web dev` keeps using `apps/web/.next-dev`, while `apps/web` smoke verification uses a separate owned dist dir.
- Root ignore/scanner/boundary-audit logic treats hosted Next generated dirs consistently.
- `apps/web` and `packages/web` Vitest configs import workspace source-resolution helpers directly instead of routing through `next.config`.
- `apps/web` and `packages/web` typecheck can recreate any required route-type stub state on a clean checkout.
- Docs explicitly describe the current source-consumed package boundary instead of implying the whole repo already follows one import-style convention.

## Scope

- In scope:
  - hosted web Next dist-dir ownership follow-up
  - audit bundle scan coverage for `config/**`
  - workspace-boundary and source-artifact scanner parity for hosted Next output
  - Vitest/source-resolution decoupling for hosted/local web
  - route-type stub bootstrap for clean typecheck
  - directly affected docs/tests
- Out of scope:
  - repo-wide conversion of every relative `.js` specifier
  - unrelated hosted onboarding or Cloudflare runtime fixes
  - upstream Turbopack NFT warning cleanup

## Tasks

1. Extend source-bundle selection to include `config/**`.
2. Give hosted dev smoke its own Next artifact directory and update hygiene lists for it.
3. Decouple web Vitest configs/tests from `next.config` workspace-resolution helpers.
4. Add a clean-checkout route-type stub bootstrap for web typecheck.
5. Update docs to reflect the explicit source-consumed package boundary and the new hosted smoke artifact ownership.

## Verification

- `pnpm --dir packages/web test` passed.
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/next-config.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm zip:src` passed and produced a `2.5 MB` archive that includes `config/workspace-source-resolution.ts`.
- Direct scenario proof: held `pnpm --dir apps/web dev --hostname 127.0.0.1 --port 4010` open, ran `pnpm --dir apps/web dev:smoke` in the same checkout, then confirmed the live server still returned `200` and both `apps/web/.next-dev` and `apps/web/.next-smoke` existed.
- `pnpm --dir apps/web test` remains blocked by unrelated dirty-tree type errors in hosted-execution/onboarding files outside this lane.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` remain blocked by unrelated dirty-tree errors in `packages/assistant-runtime`.
Completed: 2026-03-28
