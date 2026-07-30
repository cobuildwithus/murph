# PR #1126 final-review remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve final ReviewGPT round 1's accepted high finding without weakening
  crash/ambiguous-outcome recovery.
- Let one acknowledged source-active process converge legitimate live source
  churn across sequential copy cycles.

## Constraints

- Source remains read-only; destination remains create-only.
- Source-key provenance stays process-local and is never trusted by a later
  process.
- No journal, queue, distributed lock, delete authority, or
  destination-active copy path.

## Evidence

- A clean first cycle can copy source object A, observe A deleted by ordinary
  garbage collection, and then discover new source object B.
- The prior implementation accepted A at the end of that cycle but a required
  new process correctly rejected destination-only A before it could copy B.
- The focused suite proves A is copied and garbage-collected, B appears, and
  the same process copies B in a second cycle while a fresh process still
  rejects destination-only provenance.
- Focused online-copy tests pass 28/28, Cloudflare Node tests pass 2,159/2,159,
  Workers-runtime tests pass 3/3, and both Cloudflare and rehearsal-harness
  typechecks pass.

## Tasks

1. [x] Keep cumulative observed-source provenance inside one apply invocation
   and loop while final inventory still contains source-only objects.
2. [x] Preserve strict fresh-process rejection and ambiguous-outcome failure.
3. [x] Run focused/full Cloudflare verification and rehearsal-harness
   typecheck.
4. [x] Close this plan, push the correction head, and run final ReviewGPT
   correction verification with exact-head CI.
Completed: 2026-07-29
