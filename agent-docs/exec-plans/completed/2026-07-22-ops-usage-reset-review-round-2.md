# Resolve ops usage reset ReviewGPT round 2 findings

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Close the three correction-verification gaps without adding a new policy,
  delivery owner, runtime recovery mechanism, or persisted state.

## Success criteria

- The ops table derives blocked/available status only from the canonical gate
  decision, including stale persisted `blocked_at` after plan changes.
- Reset and wake-only recovery bound the existing runtime signal with the
  repository's existing post-commit deadline and return the documented 202
  partial state when the signal stalls.
- Generic Linq provider fences retain deterministic delivery IDs and runtime
  latency linkage; only a newly released usage-limit notice gets a fresh
  durable attempt ID and provider idempotency identity.
- Focused production-path regressions, required audits, canonical verification,
  CI, and ReviewGPT round 3 pass on the final pushed head.

## Constraints

- Reuse the canonical allowance decision, bounded post-commit utility, and
  existing Linq delivery claim owner.
- Preserve reset serializability, logical notice lookup identity, ordinary
  provider retry idempotency, immutable usage/history, credits, and mailbox
  work.
- Do not add schema, queues, schedulers, lifecycle state, repair passes, or a
  second source of truth.

## ReviewGPT round 2 evidence

- Accepted: dashboard labels used raw persisted `blocked_at` even when the
  canonical gate allowed or denied under a changed plan limit.
- Accepted: an indefinitely pending runtime signal bypassed the rejected-promise
  catch, preventing the committed-reset 202 and wake-only recovery journey.
- Accepted: random IDs in the shared generic Linq fence path disagreed with the
  deterministic ID returned by runtime outcome recording and could break the
  latency foreign key.

## Round 3 retrospective

- Trigger: the next correction-verification pass is substantive round 3.
- All three findings are review-induced and arise from corrections introduced
  after the first reviewed head: one remaining raw projection field, one
  unbounded call to an existing signal, and fresh identity placed at a shared
  helper instead of the usage-notice caller.
- Decision: continue the same PR with three owner-boundary reductions. Delete
  raw block metadata from the dashboard projection, wrap the signal with the
  existing bounded post-commit primitive, and restore deterministic identity
  at the generic delivery helper while injecting freshness only from the usage
  notice path. No new concepts or durable owners are necessary.

## Tasks

1. Add plan-change projection tests and remove raw blocked status from the ops
   snapshot/UI contract.
2. Add a never-settling signal test and apply the existing post-commit deadline
   to reset and wake-only operations, forwarding its abort signal.
3. Add the combined runtime-fence/outcome identity proof and scope fresh IDs to
   usage-limit notice claims only.
4. Run focused and database regressions, completion audits, canonical
   verification, CI, and ReviewGPT round 3.

## Completion-audit follow-up

- Frontend review found that a historical notice claim still suppressed the
  canonical Available badge. Admission and notice status now render
  independently, with an increased-plan regression.
- Coverage-write added the missing never-settling wake-only test, proving it
  returns the committed-partial response at the shared deadline and never
  replays reset.

## Verification

- Focused seven-file Vitest suite: 252 passed.
- Web prepared typecheck: passed.
- Local PostgreSQL reset/notice concurrency proof: passed.
- `git diff --check`: passed.
- Coverage-write and frontend-review: no unresolved findings; rendered browser
  proof was unavailable because no browser backend was connected.
- Canonical `pnpm test:diff`: passed in Blacksmith Testbox
  `tbx_01ky5wpsf6m3ryfj3w6b1sm36b`.
- Canonical `pnpm verify:acceptance`: all changed web paths passed, but the lane
  remained non-green because the untouched CLI release audit expects an older
  ReviewGPT-doc sentence that does not include `product-experience-review`.
  Blacksmith Testbox: `tbx_01ky5wpsf6vjhfnzfpcv03evr9`.
Completed: 2026-07-22
