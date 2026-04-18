# Refactor hosted local e2e harness around owner seams

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Refactor the hosted local test stack so full-stack hosted E2E uses real owner seams instead of ad hoc shell/process control, while worker-only duplicate-commit coverage moves onto an explicitly narrower harness.

## Success criteria

- Hosted local Linq, Telegram, and webhook specs use shared scenario helpers instead of duplicating stack startup, seeding, wake handoff, and outbound polling logic.
- The full-stack hosted local harness uses typed owner seams for Cloudflare wake/status and web-owned hosted-wake control instead of raw bespoke request building.
- Worker-only duplicate-commit coverage is clearly separated from the full-stack hosted local E2E harness.
- The hosted local launcher/test harness owns the child processes it starts and no longer relies on broad `pkill -f` cleanup.
- Scoped Cloudflare hosted local verification passes, or any unrelated pre-existing failures are identified explicitly.

## Scope

- In scope:
- `apps/cloudflare/scripts/run-hosted-local-e2e.ts`
- `apps/cloudflare/test/helpers/**`
- `apps/cloudflare/test/hosted-local-*.test.ts`
- `scripts/dev-hosted-local/**`
- small app-owned hosted local seed/test helpers under `apps/web/**` when needed to remove subprocess-only harness behavior
- Out of scope:
- hosted product behavior changes
- shared hosted wake contracts or production route-shape changes unless strictly needed for test-harness extraction
- unrelated hosted onboarding, pricing, or auth work already in flight

## Constraints

- Technical constraints:
- Keep full-stack hosted local E2E aligned with the architecture where `apps/web` owns wake append/cursor truth and `apps/cloudflare` owns wake execution only.
- Preserve existing public and internal production route contracts.
- Avoid adding production compatibility code or broad test-only production surfaces.
- Product/process constraints:
- Preserve unrelated worktree edits and note overlap with the active hosted pricing lane that also names `scripts/dev-hosted-local/main.ts`.
- Use owner-scoped helpers/clients that already exist where possible instead of inventing new cross-package seams first.

## Risks and mitigations

1. Risk: Refactoring the launcher and harness together could destabilize local hosted dev startup.
   Mitigation: keep the existing CLI entrypoint behavior intact and extract reusable startup helpers under the existing `scripts/dev-hosted-local/**` owner.
2. Risk: Moving the duplicate-commit lane may lose useful coverage.
   Mitigation: preserve the behavioral assertions, but make the lane explicitly worker-only and keep it on the dedicated worker fixture.
3. Risk: Existing active hosted work may overlap on local-dev files.
   Mitigation: keep the lane narrow, register the overlap in the coordination ledger, and avoid unrelated env/runtime changes.

## Tasks

1. Extract a reusable hosted local stack launcher from the existing local-dev entrypoint so tests can start/stop owned processes directly.
2. Build shared full-stack hosted local scenario helpers around existing owner clients for Cloudflare control and web-owned hosted wake APIs.
3. Replace shell-script seeding and duplicated transport polling with reusable app-owned seed helpers and transport observers.
4. Reclassify the duplicate-commit lane onto the worker-only fixture and keep the full-stack E2E suite focused on real web-plus-worker flows.
5. Run scoped Cloudflare hosted local verification and commit the refactor with the closed plan.

## Decisions

- Use existing owner seams first:
  - `packages/cloudflare-hosted-control` for Cloudflare wake/status
  - `apps/cloudflare/src/web-control-plane.ts` for web-owned hosted-wake append/status helpers
  - app-owned seed logic extracted from `apps/web/scripts/seed-hosted-active-*.ts`
- Keep worker-only duplicate-commit coverage separate from full-stack hosted local E2E.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm --dir apps/cloudflare test:e2e:telegram:local`
- `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- truthful diff-scoped verification for touched owners
- Expected outcomes:
- Hosted local full-stack E2E passes on the shared harness.
- Worker-only duplicate-commit coverage still passes on its dedicated lane.
Completed: 2026-04-18
