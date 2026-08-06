# Propagate Temporal request deadline into hosted runtime command budget

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Ensure a slow hosted-runtime wake returns a typed `retry_later` response before
  the Temporal activity request deadline instead of leaking into an outer
  transport timeout that delays the member reply.

## Success criteria

- The existing Temporal request-start timestamp shortens the Cloudflare command
  budget across route and Durable Object dispatch time.
- Missing request timing preserves the current local-budget behavior.
- Future request timing cannot extend Cloudflare's locally configured cap.
- An already exhausted request returns `retry_later` before runner state or
  container work begins.
- Existing per-user write-fence coordination remains the sole concurrency owner.
- Focused Cloudflare tests and typecheck pass; required PR review and CI are
  clean on the exact pushed head.

## Scope

- In scope:
  - Reuse the request timing already carried in runtime orchestration metadata.
  - Clamp that timing at the UserRunner command-budget boundary.
  - Add focused regression coverage for elapsed, exhausted, future, fallback,
    and existing concurrent-wake behavior.
- Out of scope:
  - Changing the direct web wake path.
  - Adding queues, coalescers, state owners, or retry services.
  - Changing Temporal workflow history or activity retry policy.

## Constraints

- Technical constraints:
  - Caller metadata may shorten but never extend the Cloudflare deadline.
  - Preserve the existing one-second response margin and per-step timeout caps.
  - Preserve behavior for callers that omit Temporal timing metadata.
- Product/process constraints:
  - Keep the correction state-free and within existing ownership boundaries.
  - Do not encode incident-specific member or message details in repository
    artifacts.

## Risks and mitigations

1. Risk: A future or malformed caller timestamp accidentally extends work.
   Mitigation: The route already rejects malformed timing; the budget clamps a
   valid timestamp to the local UserRunner start so it can only shorten work.
2. Risk: The shorter budget interrupts an accepted runtime start.
   Mitigation: Apply the deadline only to the existing pre-accept command path;
   invocation ownership and write-fence cleanup remain unchanged.
3. Risk: Worker and web deployments become coupled.
   Mitigation: The change consumes an existing optional field and retains the
   current fallback, so it is backward compatible and Worker-only.

## Tasks

1. Trace request timing and command-budget ownership end to end.
2. Propagate the existing request start into the command budget with a local
   upper clamp and an early exhausted-budget response.
3. Add focused deadline and concurrency regression coverage.
4. Run focused tests and Cloudflare typecheck.
5. Commit, push, open the PR, and run ReviewGPT with CI on the exact head.

## Decisions

- Keep the direct web ensure unchanged because the existing Durable Object
  write fence already serializes simultaneous wakes and no evidence identifies
  direct wake contention as the failure.
- Reuse `temporalActivityRequestStartedAtEpochMs`; do not add protocol fields or
  persisted state.
- Keep deadline derivation in `createRuntimeProcessingCommandBudget`, the
  existing owner of timeout clamping and response margin.

## Verification

- Commands to run:
  - Focused `apps/cloudflare` Vitest files covering UserRunner budgeting and the
    signed runtime-control route.
  - `pnpm --filter @murphai/cloudflare-runner typecheck`.
  - Required GitHub Actions and ReviewGPT gates on the exact PR head.
- Expected outcomes:
  - Elapsed request time reduces every command step's remaining timeout.
  - Exhausted requests return typed `retry_later` without starting runtime
    work.
  - Future timing is clamped and missing timing retains current behavior.
  - Concurrent fresh ensures still produce a single invocation owner.
- Results:
  - Focused Cloudflare tests: 217 passed across the UserRunner and signed route
    suites.
  - Cloudflare typecheck: passed.
Completed: 2026-08-06
