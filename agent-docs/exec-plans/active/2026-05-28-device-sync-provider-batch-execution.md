# Device sync provider-owned execution-time batching

Status: active
Created: 2026-05-28
Updated: 2026-05-28

## Goal

- Speed up large hosted Garmin/Junction dirty payload drains by letting `device-syncd`
  execute compatible already-durable local jobs as bounded provider-owned batches,
  while keeping one dirty payload row as one exact durable local job/ack unit.

## Success criteria

- Hosted dirty payload rows still become granular local jobs before ack.
- Same-account device-sync serialization remains intact.
- Junction direct resource jobs can batch compatible local jobs into one
  provider import/projection operation with bounded count/byte limits.
- Non-batchable providers/jobs keep the existing single-job path.
- Dirty payload preseal fanout is bounded and ordered.
- Focused regression tests cover batching, fallback, caps, and import semantics.

## Scope

- In scope:
- `packages/device-syncd` provider/job execution interface and Junction provider.
- `apps/web` dirty payload preseal concurrency bound.
- Focused unit/regression tests and durable docs when architecture wording changes.
- Out of scope:
- New hosted dirty queue, cursor, lease, or provider-specific web persistence.
- Removing per-account serialization.
- Parallel provider execution for the same account.
- Changing exact dirty payload ack semantics.

## Constraints

- Technical constraints:
- Preserve the existing job queue as the durable retry/idempotency unit.
- Keep batch execution optional and provider-owned.
- Bound batch size by job count and payload bytes.
- Avoid persisted-state schema changes unless static inspection proves they are
  necessary.
- Product/process constraints:
- Health/device payloads remain high sensitivity; logs/tests must stay metadata-only
  and synthetic.
- Create the PR after implementation commit and before required completion audits,
  then continue audits on the same branch.

## Risks and mitigations

1. Risk:
   Batch execution could accidentally widen same-account concurrency.
   Mitigation: keep one seed lease/account fence and claim only additional queued
   compatible jobs for that same account/provider inside the same worker pass.
2. Risk:
   A bad direct payload could poison a whole batch.
   Mitigation: only batch jobs whose provider batch descriptor parses/validates,
   and keep single-job fallback for all other jobs.
3. Risk:
   Large payload batches could become memory/import spikes.
   Mitigation: use small provider caps and byte budgets.

## Tasks

1. Inspect the current device-sync queue, provider interface, and Junction direct
   import path.
2. Add bounded ordered dirty-payload preseal fanout in web.
3. Add optional provider batch descriptors/execution to `device-syncd`.
4. Implement Junction direct resource batch execution with conservative caps.
5. Add focused regression tests.
6. Commit and open a PR before required audits.
7. Run required audit subagents and verification, then land any fixes.

## Decisions

- Use execution-time batching of existing durable local jobs instead of durable
  `resource_batch` jobs. This keeps durability granular and makes batching an
  optimization owned by the provider worker.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff <changed paths>`
- `pnpm test:smoke`
- Focused package tests while iterating.
- Expected outcomes:
- All required checks pass, or unrelated pre-existing blockers are named with
  focused proof for the touched paths.
