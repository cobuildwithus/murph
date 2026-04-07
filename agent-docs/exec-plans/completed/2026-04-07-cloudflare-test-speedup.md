# Speed up Cloudflare tests without coverage loss

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Reduce `apps/cloudflare verify` runtime by removing avoidable setup cost from the slow queue-backpressure route tests and by giving the Cloudflare node suite more file-level parallelism, without dropping any behavioral coverage.

## Success criteria

- The route-layer queue-backpressure assertions still pass.
- At least one lower-layer queue/runner test still exercises real queue saturation through the dispatch path.
- The Cloudflare node Vitest workspace is partitioned so the backpressure route tests no longer serialize the whole `index.test.ts` file.
- Focused Cloudflare verification passes.

## Scope

- In scope:
  - Cloudflare test helpers and test-file layout.
  - Vitest project include patterns needed for the split test files.
- Out of scope:
  - Cloudflare runtime behavior changes.
  - Broad repo-wide verification or unrelated hosted runner refactors.

## Constraints

- Technical constraints:
  - Preserve existing route assertions and queue semantics.
  - Reuse existing queue seeding/storage helpers where possible instead of inventing new runtime seams.
- Product/process constraints:
  - Do not reduce test coverage just to lower runtime.
  - Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Direct queue seeding could weaken route-layer coverage if it bypasses the behavior under test.
   Mitigation: Keep one lower-layer dispatch-path saturation test intact and use seeded state only for route tests that begin from "queue already full".

2. Risk: Splitting the large file could break shared test setup or ordering assumptions.
   Mitigation: Move only the isolated backpressure route cases first and keep the new file self-contained.

## Tasks

1. Extract or reuse a queue-state seeding helper that can populate pending/backpressured rows quickly.
2. Move the slow backpressure route tests out of `apps/cloudflare/test/index.test.ts` into a dedicated file that uses the seeded state.
3. Update the Cloudflare node Vitest workspace includes if needed for the new file.
4. Run focused Cloudflare verification and capture the outcome.

## Decisions

- Keep queue saturation coverage by leaving the lower-layer `user-runner` saturation tests intact while speeding up only the route-layer setup.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test:node`
  - `pnpm --dir apps/cloudflare verify`
- Expected outcomes:
  - The Cloudflare node suite passes with the split test files.
  - `apps/cloudflare verify` passes and no longer spends unnecessary time queue-filling in the route-layer cases.
Completed: 2026-04-07
