# Runtime completion receipt

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Eliminate the stale write-fence probe from normal cold starts by recording an
  exact successful runtime completion at the durable UserRunner owner before a
  detached UserRunner continuation can be evicted.

## Success criteria

- RunnerContainer sends one best-effort completion receipt only after a valid
  runner result is terminal and its active-operation record is gone.
- UserRunner clears only the exact runtime fence identified by user, attempt,
  and generation, and emits the existing owner-release callback at most once.
- Callback failure, mixed Worker versions, duplicate delivery, consent
  withdrawal, replacement generations, and failed invocations preserve current
  fail-closed behavior.
- Focused tests, Cloudflare typecheck, hosted-local proof, ReviewGPT, and exact
  PR-head CI pass without a deployment or merge.

## Scope

- In scope: one additive internal RunnerContainer-to-UserRunner RPC, reuse of
  the existing completion CAS and owner-release owner, focused diagnostics,
  regression tests, and durable protocol/reliability documentation.
- Out of scope: checkpoint-as-completion, fence TTLs, alarms, queues, new
  persisted state, container lifecycle callbacks, deployment, or merge.

## Constraints

- A checkpoint is not owner release; the receipt follows full successful
  invocation settlement.
- The current detached UserRunner completion remains as a mixed-version and
  callback-failure fallback for the first rollout.
- The receipt is best-effort and cannot change the successful runner result.
- No callback may clear a newer fence or a fence cleared for user control.

## Risks and mitigations

1. A terminal callback could race the original completion path.
   Mitigation: both paths use the same exact CAS owner and only the CAS winner
   emits owner release.
2. A callback could run before the container is truly inactive.
   Mitigation: send it only after the invocation result resolves and verify the
   RunnerContainer active-operation pointer is absent in a regression test.
3. Mixed deployed versions could lack the RPC method.
   Mitigation: make the stub method optional, swallow metadata-only callback
   failures, and retain the current outer completion path.
4. A slow receipt could block the completed result and its outer fallback.
   Mitigation: cap the receipt wait at one second and observe late rejection.

## Tasks

1. Add the exact completion receipt contract and UserRunner delegate.
2. Reuse the existing completion CAS/release path idempotently.
3. Emit the receipt from RunnerContainer after terminal cleanup.
4. Add unit, race, failure, and hosted-local regression proof.
5. Run focused verification, inspect the diff, push an exact candidate, and run
   the required specialist/final ReviewGPT and CI gates.

## Decisions

- Prefer a direct internal RPC over an alarm or timer because RunnerContainer
  already owns exact terminal evidence and UserRunner already owns the durable
  CAS mutation.
- Keep the 60-second idle-checkpoint change independent; it narrows but cannot
  eliminate the detached-continuation eviction race.

## Verification

- Focused RunnerContainer, UserRunner, hosted-local control, and Worker route
  tests passed on the reviewed candidate. After base reconciliation, the final
  RunnerContainer/UserRunner slice passed 304 tests, and the repaired
  fake-timer cadence proof passed in three consecutive isolated runs.
- The two assistant-runtime suites affected by the reconciled conversation
  session shape passed 286 tests.
- Cloudflare typecheck passed.
- The real hosted-local lost-active-operation scenario passed after discarding
  the completed outer result, clearing the exact fence by receipt, expiring the
  warm shell, and completing a fresh follow-up wake.
- Preliminary specialist ReviewGPT completed, and final ReviewGPT rounds 1 and
  2 passed with no remaining qualifying findings on the substantive candidate.
- Required GitHub Actions passed on exact pushed head
  `126b1b62e8eb00fac85b09644dc2696919ce15fc`.
- `git diff --check` and the scoped identifier/home-path privacy scan passed.
Completed: 2026-08-06
