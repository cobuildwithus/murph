# PR 857 phone-call context retrospective

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Complete the required ReviewGPT retrospective, shrink the prior remediation so
each existing owner keeps its causal identity, make proven invalid phone-call
origins terminal without weakening transient retries, and certify the exact PR
head through focused proof, acceptance, CI, and ReviewGPT.

## Retrospective decision

- The original requirement remains: record a completed call exactly once as
  bounded untrusted context on the existing direct session that initiated it,
  before a causally later attended turn, with no automatic delivery or route
  guessing.
- The first-reviewed implementation kept preference intent time in
  `preferenceCausalSeq` and processed preferences through their dedicated
  pre-planning route. The round-1 remediation replaced that field with a
  generic causal sequence and combined preferences with phone results under one
  selector. That review-driven coupling can substitute mailbox transport order
  for preference intent time and let one route hide eligible work on the other.
- Choose shrink/revert: restore the preference-owned causal field and process
  preference and phone-result routes independently. Phone results alone use
  mailbox causal sequence against the accepted conversation frontier.
- A missing or non-direct origin is a proven permanent fail-closed result. Treat
  it as terminal no-op completion so it releases later phone results. Preserve
  ordinary retry behavior for storage, lock, and other transient failures.
- Add no queue, state machine, owner, reconciliation loop, fallback route, or
  replacement session.

## Tasks

1. Add regression proof for preference intent sequence 10, accepted input 11,
   and later preference transport sequence 12; prove independent pre-planning
   route progress.
2. Restore `preferenceCausalSeq` beside the phone-only `causalSeq` and run the
   two route owners independently before planning.
3. Classify only missing/non-direct origin-session results as terminal no-ops;
   prove invalid A releases valid B while transient failures remain retryable.
4. Repair the hosted Retell fixture with a real initiating Linq session, then
   run focused tests, the exact hosted E2E, `pnpm test:diff`, and
   `pnpm verify:acceptance`.
5. Commit, push, record the retrospective and current change shape on PR 857,
   then run ReviewGPT round 3 concurrently with CI until both pass.

## Constraints

- Keep first-reviewed head `606ce441664021a6dddcd14c6cba7ac7c5023ce2`
  immutable.
- Preserve exact-session binding, cross-session idempotency rejection, the
  4,000-byte UTF-8 limit, untrusted framing, and zero automatic delivery.
- Preserve unrelated mailbox routes and overlapping worktree changes.

## Verification

- Focused assistant-engine conversation-context and assistant-runtime mailbox,
  phase, runner, and phone-result tests passed: 5 files and 298 tests.
- Hosted-local `retell-call-result-roundtrip` passed with a real initiating Linq
  session and no automatic result delivery.
- `pnpm verify:acceptance` passed on an owned 16-vCPU Blacksmith Testbox in
  7m07s, including every workspace typecheck, package coverage, Web verify and
  build, and Cloudflare verify.
- Local `pnpm test:diff` passed all affected package suites and Web verification
  before the shared-host Cloudflare step was interrupted after unrelated
  worktrees repeatedly reacquired the host slot. Two fresh Crabbox `test:diff`
  attempts reproduced 60-second timeouts only in untouched CLI subprocess tests;
  the same tests passed in the local full CLI suite and the green acceptance
  profile, isolating the failure to the remote diff executor.
- Exact-head PR CI, mergeability proof, and ReviewGPT round 3 follow the scoped
  commit and push.
Completed: 2026-07-22
Completed: 2026-07-22
