# Keep phone-transfer locks provider-free

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep settings phone-transfer source retirement from holding phone advisory
  locks and two member row locks across KMS-backed identity or billing reads,
  without changing the existing lock namespace or retirement behavior.

## Success criteria

- ReviewGPT independently confirms or rejects the issue on current
  `origin/main` and, if confirmed, returns an apply-ready scoped patch.
- Provider-backed identity and billing preparation finishes before transaction
  checkout; the locked phase re-reads and validates exact raw fingerprints.
- Both current call sites use the same prepared contract while preserving the
  canonical sorted phone and member lock order.
- Focused unit and real-PostgreSQL tests cover delayed provider work, both lock
  orderings, and snapshot drift.
- Focused checks, Web typecheck, exact-head specialist/final ReviewGPT, and
  required draft-PR CI reach their honest completion boundaries.

## Scope

- In scope: settings phone-transfer retirement preparation, its two current
  call sites, and focused unit/PostgreSQL proof.
- Out of scope: new caches, services, managers, queues, advisory-lock
  namespaces, schema changes, broader account-deletion refactors, or changes to
  phone-transfer product behavior.

## Constraints

- Technical constraints: prepare exact identity and billing snapshots outside
  checkout; carry raw-row fingerprints; compare those fingerprints under the
  unchanged sorted locks; keep the final phase database-only.
- Product/process constraints: ReviewGPT authors the implementation patch if it
  agrees; do not reconstruct a missing artifact; separate draft PR only; never
  mark Ready, merge, or deploy.

## Risks and mitigations

1. Risk: preparation races with identity or billing mutation.
   Mitigation: exact raw fingerprints are re-read and compared under the
   existing canonical locks; drift fails closed.
2. Risk: moving provider work changes retirement classification or ordering.
   Mitigation: retain current classification predicates, lock ordering, and
   call-site sequencing; prove both two-client orderings.
3. Risk: a broad abstraction makes this narrow boundary harder to maintain.
   Mitigation: reuse existing raw projection/equality patterns and reject new
   owners or general frameworks.

## Tasks

1. Send a clean current-main repository snapshot to a separate Eragon
   ReviewGPT implementation thread with an agree/reject and patch contract.
2. Validate the returned response, artifact identity, checksum, touched paths,
   and architecture before applying anything.
3. If accepted, apply only the scoped patch and inspect every production and
   test hunk against the transaction/provider boundary.
4. Run focused unit, PostgreSQL concurrency, lint/static, and Web type checks.
5. Finish the scoped commit, push, and open a separate draft PR with complete
   evidence and deployment disposition.
6. Start exact-head completion-specialists and final ReviewGPT concurrently
   with required CI, then report the validated results and any blockers.

## Decisions

- Base the implementation review on exact current `origin/main`; unrelated
  later base movement alone will not invalidate a scoped patch.
- Preserve the sorted phone-advisory and member-row lock scheme; this task only
  moves provider-backed preparation before checkout and validates drift.
- Accepted the recovered patch after exact reverse-application proof and full
  hunk inspection. Corrected its PostgreSQL fixture to use a structurally valid
  signed control-root envelope required by the current database constraints.

## Progress

- Recovered artifact identity and checksum: verified.
- Focused unit tests: 207 passed.
- Real-PostgreSQL concurrency tests: 8 passed.
- Focused ESLint and agent-docs drift: passed.
- Exact frozen-candidate remote `test:diff`: passed, including Web TypeScript,
  lint, build, smoke, and 11,195 tests.

## Verification

- Commands to run: ReviewGPT artifact validation; focused phone-transfer unit
  tests; opt-in real-PostgreSQL concurrency tests; scoped lint/static checks;
  Web typecheck; PR exact-head ReviewGPT and required GitHub Actions.
- Expected outcomes: no provider/KMS call occurs after transaction entry,
  unrelated work remains available while provider work is delayed, both lock
  orderings complete without deadlock or pool starvation, drift rejects safely,
  and all required exact-head gates are green or explicitly blocked.
Completed: 2026-08-26
Completed: 2026-08-26
