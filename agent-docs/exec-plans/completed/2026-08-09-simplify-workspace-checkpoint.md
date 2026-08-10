# Simplify workspace checkpointing without breaking atomicity

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Reduce the frequent idle-shutdown checkpoint transaction to one workspace
  version-CAS statement plus one set-based mailbox/counter statement while
  preserving atomic snapshot publication, exact handled-input stamping, and
  contiguous lane-watermark advancement.

## Success criteria

- A stale workspace version changes no workspace, mailbox, or lane-counter row.
- A successful checkpoint atomically publishes the successor workspace,
  reports the replaced snapshot, stamps only eligible handled conversation
  inputs, and advances system/conversation counters without crossing a live
  unhandled gap.
- Newer conversation input may set `conversationInputAhead` without rejecting
  an otherwise valid workspace CAS.
- The explicit workspace row lock and final workspace reread are removed when
  the statement's returned row can provide the authoritative result.
- Focused unit and PostgreSQL concurrency tests, Web typecheck, required
  ReviewGPT gates, and exact-head CI pass.

## Scope

- In scope: the Web-owned hosted workspace checkpoint store, its mailbox/lane
  SQL, focused tests, and any live owner documentation that must change to
  describe the implementation truth.
- Out of scope: runtime snapshot construction/upload, provider or KMS work,
  mailbox append semantics, schema changes, new state owners, queues, or
  compatibility machinery.

## Constraints

- Technical constraints: workspace `version` remains the sole checkpoint
  conflict authority; every dependent mailbox/counter mutation remains in the
  same database transaction and conditional on the successful CAS; contiguous
  conversation progress cannot skip an unconsumed live row; returned conflict
  behavior remains compatible.
- Product/process constraints: prefer deletion and set-based SQL; preserve
  unrelated checkout work; integrate ReviewGPT's patch only after independent
  inspection; complete the worktree/PR, specialist/final review, and CI lane.

## Risks and mitigations

1. Risk: a CTE executes mailbox mutations even when the workspace CAS loses.
   Mitigation: derive every mutation from the CAS `RETURNING` relation and add
   stale-version proof.
2. Risk: set-based prefix calculation advances past a live gap or mishandles
   retention/expiry semantics.
   Mitigation: preserve the current bounded eligible-row predicate exactly and
   add gap, expiry, missing-counter, and concurrent-append tests.
3. Risk: removing rereads changes response semantics.
   Mitigation: return the successor workspace and replaced snapshot directly
   from the versioned statement; keep a narrow conflict read only if the public
   conflict response demonstrably requires it.

## Tasks

1. Trace the current checkpoint SQL, response contract, mailbox counter owner,
   and focused test coverage.
2. Delegate the scoped implementation to ReviewGPT and require an attachment
   patch with focused tests.
3. Inspect and apply the patch, correcting only proven gaps while preserving
   the smallest architecture.
4. Run focused unit/PostgreSQL tests and Web typecheck; inspect the complete
   diff and privacy-redact durable artifacts.
5. Commit and push the exact candidate, run preliminary specialists and final
   ReviewGPT concurrently with CI, resolve findings, and close the plan.

## Decisions

- Keep Postgres and the existing Web workspace owner; introduce no new owner or
  durable state.
- Treat the workspace version predicate as the checkpoint linearization point.

## Verification

- Commands to run: focused `hosted-workspace-store` unit tests, focused hosted
  Web PostgreSQL concurrency tests selected after patch inspection, Web
  typecheck, scoped architecture/doc guards, exact-head PR CI, preliminary
  `completion-specialists`, and final ReviewGPT.
- Expected outcomes: all pass; concurrency proof shows no dependent mutation
  on CAS loss and no watermark advancement beyond the first eligible gap.
Completed: 2026-08-09
