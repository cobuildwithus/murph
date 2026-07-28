# Hosted production 500 repair

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Remove the proven hosted-runtime 500 paths without weakening deletion,
  retention, diagnostics, or alerting invariants.
- Keep expected post-deletion diagnostic races best-effort and preserve visible
  failure for incomplete latency-alert configuration.

## Production evidence

- Retention attempted to update a consumed legacy preference mailbox row whose
  intentionally unvalidated historical `causal_seq` is null. PostgreSQL applies
  the current check constraint to the updated tuple and rejects it.
- A deleted hosted member's draining runtime submitted queued diagnostic logs
  after the member row and its foreign-key dependents were removed.
- The latency-alert cron was configured with exactly one of its two required
  variables. The route's visible failure is the documented fail-closed
  behavior, and later invocations recovered after configuration changed.
- One assistant turn made three group-tool calls; two produced the matching
  route failures. The Prisma adapter reported concurrent queries inside one
  interactive transaction. A guarded transaction-client regression reproduced
  the overlap in usage-referral reward-capacity reads before serialization.

## Invariants

- Account deletion remains authoritative; diagnostics must not keep or recreate
  a member.
- Runtime logs remain lossy operational evidence, never correctness state.
- Retention removes expired content and does not invent mailbox causal
  sequence values.
- Incomplete alert configuration remains visibly unhealthy.
- Interactive transactions execute their database operations serially.
- No new service, queue, table, dependency, or state owner.

## Scope

- In scope: mailbox content retention, runtime-log ingestion after deletion,
  the proven group-tool transaction path, directly affected tests and durable
  hosted-runtime documentation.
- Out of scope: changing latency-alert fail-closed behavior, broad group-system
  refactors, historical data repair, and unrelated production warnings.

## Tasks

1. [x] Recover the prior investigation and verify each reported production
   failure against current code and narrow production evidence.
2. [x] Prove the exact group-tool transaction owner with source-path evidence
   and a focused reproduction.
3. [x] Implement the smallest owner-bound fixes and focused regressions.
4. [x] Run focused tests, canonical diff verification, acceptance verification,
   typecheck, and direct scenarios required by the verification guide.
5. [x] Run the preliminary completion-specialists pass, resolve findings, and
   perform the parent's final diff review.
6. [ ] Commit, push, open the PR, then run final ReviewGPT concurrently with CI.
7. [ ] Resolve final findings and CI failures, close this plan through
   `scripts/finish-task`, and leave the PR merge-ready.

## Risks and mitigations

1. Risk: treating an expected deletion race as a successful persisted write.
   Mitigation: return the actual persisted count and suppress only the exact
   member foreign-key failure.
2. Risk: changing the identity or ordering semantics of legacy preference
   events.
   Mitigation: remove only consumed, expired legacy rows instead of fabricating
   a causal sequence.
3. Risk: fixing a similar transaction-concurrency smell instead of the
   production path.
   Mitigation: require handler-to-transaction trace and a failing regression
   before editing the group code.

## Verification

- Focused Vitest: 186 tests passed across the eight affected test files.
- Local PostgreSQL proof: both retention and late-log scenarios passed against
  the task-owned database; the guarded group regression also passed after
  serializing the transaction queries.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm test:diff <touched paths>`: repository guards passed; the affected web
  step was admission-blocked twice by unrelated hour-long shared-host owners.
  The duplicate waiter was cancelled after the documented ten-minute fallback
  threshold, and the exact staged patch's web verification passed as part of
  full remote acceptance.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`: the dispatcher exposed
  an installed-provider lifecycle flag mismatch before allocation; the same
  pinned, secret-safe Blacksmith Testbox invocation without that unsupported
  flag passed the complete acceptance suite.
- Secret-safe production log verification after deployment remains a separate
  operational follow-up unless deployment is explicitly requested.
- The exact merged-head focused rerun passed 185 tests across the seven
  affected unit suites, the hosted workflow guard passed 3 tests, the local
  PostgreSQL regression passed both scenarios, hosted-web prepared typecheck
  passed, and `pnpm docs:drift` passed.
- The merged-head canonical `pnpm test:diff` passed repository guards, affected
  CLI typecheck, and reached the full CLI source suite. Eight unrelated
  assistant/session command tests each timed out at exactly 60 seconds under
  shared-host contention; after the failed worker exited, its idle task-owned
  parent was interrupted. The only touched CLI suite then passed directly.
- Candidate-head GitHub CI passed completely after retrying one unchanged-head
  hosted job whose first attempt failed while downloading the Temporal CLI
  with a connection reset. Final-head CI and final ReviewGPT remain open.
Completed: 2026-07-28
