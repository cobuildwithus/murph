# Land Next.js review patch across hosted and local web

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Port the supplied Next.js review patch onto the current worktree without overwriting unrelated edits, keeping the hosted and local web apps aligned with the intended Next.js 16 config and routing cleanup.

## Success criteria

- `apps/web` uses a Turbopack-native optional-module alias instead of a custom webpack hook.
- `typescript.ignoreBuildErrors` is removed from both Next apps so build-time type errors are no longer suppressed.
- Internal route anchors covered by the supplied review are migrated to `next/link`.
- Redundant hosted `dynamic = "force-dynamic"` exports are removed where the route is already dynamic via `cookies()` or `searchParams`.
- Required verification and the package-local browser inspection are completed, or any blocker is documented with evidence.
- The change is closed with the repo's scoped commit workflow.

## Scope

- In scope:
  - `apps/web/next.config.ts` plus the new empty-module shim target.
  - Hosted route/module cleanup in `apps/web/app/**` and `apps/web/src/components/**` matching the supplied review.
  - `packages/local-web/next.config.ts` and the internal connect link on the local home page.
- Out of scope:
  - New dependency changes.
  - Follow-up recommendations from the review report that were not patched, such as ESLint setup or new `loading.tsx` files.
  - Unrelated hosted onboarding, device-sync, or Cloudflare edits already in flight.

## Constraints

- Preserve unrelated dirty-tree edits and merge carefully around overlapping hosted onboarding files.
- Keep package boundaries and current monorepo tracing/source-resolution setup intact.
- Do not reintroduce webpack-specific build behavior into the hosted Next 16 app.

## Risks and mitigations

1. Risk: The patch overlaps currently dirty hosted onboarding files.
   Mitigation: Read current file state first and land only the review-intended delta.
2. Risk: Re-enabling build-time type checking could surface unrelated pre-existing type issues during verification.
   Mitigation: Run the required verification baseline and record whether any failures are attributable to the landed diff.
3. Risk: Local-web UI verification requires a rendered inspection, not just static code review.
   Mitigation: Start the app and inspect the affected route at desktop and mobile widths before handoff.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied patch against the live tree.
2. Port the Next config changes in `apps/web` and `packages/local-web`.
3. Port the hosted/local route and client-component link cleanup plus redundant dynamic-export removal.
4. Run the required verification and direct UI inspection, then fix any regressions.
5. Close the plan with the scoped commit helper.

## Decisions

- This is plan-bearing even though the source patch is bounded because it spans multiple files, overlaps existing dirty edits, and needs repo-required verification plus local UI inspection.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Additional proof:
  - Desktop and mobile browser inspection of the affected `packages/local-web` home route.
Completed: 2026-04-01
