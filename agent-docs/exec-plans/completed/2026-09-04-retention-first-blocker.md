# Bound mailbox retention blocker lookup

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Keep the 5,000-row mailbox retirement batch from aggregating every pending
  conversation row when it advances each affected lane's contiguous floor.

## Success criteria

- Each affected conversation member resolves only the first unconsumed
  non-retired blocker after the current floor.
- The query uses the existing member/lane/sequence index and performs no
  backlog-wide blocker aggregation.
- Policy non-reply retirement and contiguous-floor semantics remain unchanged
  under real PostgreSQL.
- Focused tests, hosted-Web typecheck, exact-head CI, and ReviewGPT pass.

## Scope

- In scope: the mailbox retirement CTE, its SQL-shape proof, PostgreSQL
  retention semantics, and the directly affected reliability contract.
- Out of scope: retention windows, batch sizes, mailbox schema/index changes,
  additional schedulers, and other retention categories.

## Constraints

- Preserve the one-statement transactional owner for ciphertext retirement,
  explicit policy non-reply recording, and lane-floor advancement.
- Reuse the existing user, lane, and lane-sequence index and the existing
  bounded retired-row set.
- Keep hourly work bounded by the current four batches of 5,000 rows.

## Risks and mitigations

1. Risk: The lookup advances past a younger unconsumed gap.
   Mitigation: order blockers by lane sequence, take exactly one, and retain the
   existing real-PostgreSQL younger-gap test.
2. Risk: A row retired by the same data-modifying CTE still appears unconsumed
   under the statement snapshot and blocks itself.
   Mitigation: exclude exact ids returned by the bounded retired CTE.
3. Risk: Historical rows below the already consumed floor enlarge the lookup.
   Mitigation: start the indexed search strictly above the counter's current
   consumed sequence.

## Tasks

1. Replace the blocker-wide join and grouped minimum with one ordered lateral
   lookup per bounded affected member.
2. Assert the indexed first-blocker SQL shape and absence of the aggregate.
3. Run focused unit and local PostgreSQL retention proofs, typecheck, lint,
   complexity, and diff/privacy review.
4. Update the reliability contract, archive the plan, commit, and open a draft
   PR.
5. Push the exact candidate, run ReviewGPT concurrently with required CI, and
   resolve all required gates before handoff.

## Decisions

- Keep this separate from unrelated retention categories so the PR proves one
  query-plan correction without widening cleanup behavior.
- Use a lateral ordered lookup rather than a new partial index because the
  existing sequence index already matches the exact member/lane prefix and
  ordering needed by the first-blocker decision.

## Verification

- Commands to run: focused retention Vitest, the existing local PostgreSQL
  younger-gap and concurrency proofs, hosted-Web typecheck, scoped ESLint,
  pnpm complexity:diff, exact PR-head CI, and ReviewGPT.
- Expected outcomes: SQL contains one ordered lane-sequence lookup with a
  one-row limit above the current floor, contains no blocker-wide minimum, and
  PostgreSQL preserves the current contiguous-floor result.
Completed: 2026-09-04
