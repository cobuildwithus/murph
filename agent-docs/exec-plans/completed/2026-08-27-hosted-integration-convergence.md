# Stabilize hosted integration convergence

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Restore deterministic hosted integration admission so the stale Temporal
  workflow migration can ship without weakening foreground replies, durable
  handoffs, or database concurrency guarantees.

## Success criteria

- The foreground-to-Environment handoff completes without an unnecessary
  assistant pass or a stranded default-processing fence.
- Serializable contention is handled at its existing database boundary and
  does not abort an otherwise recoverable hosted handoff.
- Computer-handoff proof waits for the durable awaiting-user transition rather
  than sampling an intermediate running state.
- Focused tests, typecheck, preliminary specialist review, and exact-head CI
  pass before merge.

## Scope

- In scope: the smallest public runtime, database-boundary, and test-proof
  corrections needed by the failing hosted integration shards.
- Out of scope: changing private migration behavior, broad scheduler rewrites,
  Linq routing files owned by another open PR, and unrelated test cleanup.

## Constraints

- Technical constraints: preserve current state ownership, keep transactions
  database-only, avoid new services or abstractions, and remain compatible with
  mixed public/private blue-green deployment.
- Product/process constraints: preserve active foreground replies and handoffs,
  avoid overlapping files owned by open PRs, and use the worktree/PR lane.

## Risks and mitigations

1. Risk: treating nondeterministic CI symptoms as one bug could hide distinct
   failures.
   Mitigation: require a focused reproduction or direct code-path proof for
   each correction and keep fixes independently testable.
2. Risk: a scheduler fix could preempt legitimate foreground work.
   Mitigation: preserve the current foreground owner and correct only the
   durable successor classification or wake derived from committed state.
3. Risk: retry logic could duplicate external effects.
   Mitigation: place retry only around the database transaction before effect
   execution, using the existing idempotent boundary.

## Tasks

1. Prove the three observed failure paths from exact CI evidence and current
   source.
2. Add focused failing coverage at each owning boundary.
3. Implement the smallest non-overlapping corrections.
4. Run focused verification and review the complete diff.
5. Push a draft PR, complete specialist and final gates, then merge.
6. Rerun the private integration, merge the migration PR, and execute its
   documented blue-green rollout with post-deploy proof.

## Decisions

- Treat the foreground stall, serializable collision, and early handoff read as
  separate defects because their exact CI evidence has different owners and
  failure modes.
- Do not edit the open Linq lock-order PR's files; fix only independent owner
  boundaries.
- Do not edit assistant-phase files owned by other live PRs. Exact integration
  evidence instead places the remaining Environment correction in the private
  Temporal owner: negotiate the existing fact and select the existing mode.
- Do not take over the concurrently owned public package-release PR. Land the
  independent public fixes while its owner completes the registry publication
  required by the private worker.

## Verification

- Passed: usage-limit claim Vitest (10/10), changelog archive Vitest (9/9),
  Hosted Web prepared typecheck, scoped Web lint, Cloudflare typecheck, and
  diff whitespace validation.
- The selected hosted-local scenarios build successfully but cannot start on
  macOS because the unchanged runner bundle exceeds the platform's ratcheted
  byte budget. Exact-head Linux CI owns the full-stack proof.
- The preliminary specialist review accepted one isolated coverage gap: prove
  the ordinary Prisma serialization shape and the two-attempt ceiling. The
  inspected test-only patch now proves both, with no production change.
- Final ReviewGPT round 1 reviewed the exact pushed production candidate and
  returned `ROUND_OUTCOME: PASS` with no correctness findings. The requested
  model was verified through its compatible response metadata.
- Pull-request evidence is green. Remaining external gates are exact-head CI,
  merge, and the separately owned private integration and rollout.
- Expected outcomes: every focused regression passes repeatedly, no unrelated
  path changes, and the public/private integration gates are green on the exact
  heads merged and deployed.
Completed: 2026-08-27
