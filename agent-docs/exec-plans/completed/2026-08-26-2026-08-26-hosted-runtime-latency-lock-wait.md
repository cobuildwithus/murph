# Fail fast on hosted runtime latency row contention

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep best-effort hosted runtime latency writes from occupying a pooled
  PostgreSQL client while another writer holds the same trace-row lock.

## Success criteria

- Contended provider-start and assistant-milestone rows fail fast and are
  reported as unmatched.
- The existing bounded caller retry remains the sole recovery owner.
- Uncontended, stale-authority, untraced, no-op replay, and multi-row semantics
  remain unchanged.
- A local PostgreSQL contention proof shows the first write returns quickly,
  unrelated work can use the writer pool, and a later existing retry records
  after lock release.
- Focused tests and Web typecheck pass; the exact pushed PR head enters the
  required ReviewGPT and CI gates.

## Scope

- In scope: `apps/web/src/lib/hosted-runtime-latency/store.ts`, focused unit and
  real-PostgreSQL latency tests, the owning reliability contract, and this task
  plan.
- Out of scope: runtime-log persistence, generic Prisma telemetry, pool error
  classification, new retry owners, schema changes, and unrelated latency
  reads or alerting.

## Constraints

- Technical constraints: reuse the existing set-based statements and
  250 ms/1 s caller retry; add no worker, queue, coordinator, timeout framework,
  state owner, dependency, or generic abstraction.
- Product/process constraints: diagnostic writes remain best effort and cannot
  delay foreground runtime work; inspect ReviewGPT's patch as untrusted intent;
  open a separate draft PR and do not merge or mark it Ready.

## Risks and mitigations

1. Risk: a skipped row could still be counted as matched because eligibility is
   computed before the lock claim.
   Mitigation: derive matched rows from the successful lock claim and retain the
   separate scoped projection only for traced/untraced reporting.
2. Risk: fail-fast contention could silently lose diagnostics.
   Mitigation: return skipped rows as unmatched so the existing bounded caller
   retry performs recovery, and prove the composed path against real PostgreSQL.

## Tasks

1. Validate the finding and smallest patch independently through a dedicated
   managed-browser ReviewGPT implementation thread.
2. Inspect the returned patch against current code and apply only the scoped,
   simpler behavior.
3. Add or refine focused unit and PostgreSQL contention proof.
4. Run focused tests, typecheck, diff/privacy review, and required completion
   checks.
5. Commit, push, open a draft PR, and start exact-head ReviewGPT plus CI.

## Decisions

- Treat lock-contention skips as unmatched rather than an error; callers already
  own finite best-effort retries.
- Keep the change inside the two set-based raw write owners unless direct proof
  shows another scoped owner has the same recovery contract.

## Verification

- Focused store suite: 38 tests passed.
- Real PostgreSQL latency concurrency suite: 5 tests passed, including direct
  proof that both contended retry-backed writers return unmatched within the
  one-second proof deadline, release a one-client writer pool, and record after
  lock release.
- Existing assistant-runtime caller-retry proof: 2 tests passed, confirming
  provider-start and assistant-milestone unmatched results enter the bounded
  retry owner.
- Web typecheck, focused ESLint, docs drift, and `git diff --check` passed.
- Remaining completion proof: exact-head PR checks and ReviewGPT gates after
  push.
Completed: 2026-08-26
