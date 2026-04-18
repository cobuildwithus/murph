# Hosted hard-cut batch 3 compatibility cleanup

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Remove the next smallest set of hosted hard-cut compatibility seams without
  reopening the stable wake-first production path.
- Focus this batch on:
  - stale thin-runner queue-model types and helpers that no longer describe the
    production Cloudflare owner boundary
  - dead or clearly isolated dispatch-payload compatibility surfaces that are
    no longer used by production code

## Success criteria

- Cloudflare thin-runner types and projection helpers no longer expose dead
  pending-dispatch model artifacts that production code does not use.
- Durable docs and tests stop describing Cloudflare-owned dispatch-payload
  storage as part of the steady-state hosted architecture when that surface is
  not production-owned anymore.
- Any dispatch-payload compatibility code deleted in this batch is proven to be
  dead or strictly test-only and not owned by the active hosted-local e2e
  stabilization lane.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner/{types,runner-queue-state,runner-queue-store}.ts`
  - focused Cloudflare docs/tests that still describe the removed queue-era
    model
  - production-dead `dispatch-payload` compatibility files if their remaining
    references are clearly outside the active e2e harness lane
- Out of scope:
  - broad hosted-local e2e harness rewrites owned by
    `2026-04-18-cloudflare-e2e-stabilization.md`
  - release-manifest work in the active release lane
  - another large shared runtime contract rewrite

## Constraints

- Preserve unrelated dirty-tree edits and active ledger rows.
- Keep the Cloudflare thin runner wake-first and web-owned.
- Do not delete test-harness code that the active e2e stabilization lane still
  needs unless the replacement is clearly within this batch's safe scope.

## Tasks

1. Confirm the remaining compatibility seams that are actually dead versus
   currently used by the active e2e harness.
2. Spawn parallel subagents:
   - one for Cloudflare thin-runner stale type/helper cleanup
   - one for dispatch-payload/deploy-doc compatibility surface assessment and,
     if safe, deletion
3. Integrate the safe cleanup locally, run focused verification, then required
   audits and a scoped commit.

## Decisions

- Prefer deletion of dead compatibility surfaces over another cross-package
  dispatch-to-wake refactor in this batch.
- Avoid overlapping the hosted-local e2e stabilization lane unless the
  remaining reference is clearly dead or can be replaced with a small local
  harness change.

## Verification

- `pnpm --dir apps/cloudflare typecheck`
- focused Cloudflare vitest runs covering:
  - `test/runner-queue-state.test.ts`
  - `test/runner-queue-store.test.ts`
  - any touched `dispatch-payload` / storage-path / lifecycle / docs-adjacent
    tests
Completed: 2026-04-18
