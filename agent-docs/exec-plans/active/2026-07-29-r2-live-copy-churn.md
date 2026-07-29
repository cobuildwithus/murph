# Tolerate live R2 source churn during online copy

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make the create-only R2 online copier converge while production legitimately
  garbage-collects immutable workspace objects.
- Preserve fail-closed behavior for destination failures, source identity
  changes, unexpected destination-only objects, and any production mutation.
- Complete a virgin isolated-destination rehearsal and measure the full bulk
  copy plus post-copy verification time.

## Success criteria

- A CopyObject 404 is tolerated only when an immediate source HEAD proves the
  planned source object no longer exists.
- CopyObject is attempted once, and every apply pass requires an explicit
  operator assertion that no other copier can target the bucket pair.
- Apply passes are prohibited after destination activation, where a late
  ambiguous commit cannot be distinguished from legitimate ENAM-native data.
- End-of-pass validation accepts destination-only immutable objects only when
  they were present in the pass's initial source inventory; all other
  destination-only objects still fail closed.
- Every immutable object present in the final source inventory exists
  identically in the destination, or the pass reports that another create-only
  convergence pass is required.
- Focused tests, diff-aware verification, ReviewGPT, CI, and a fresh isolated
  rehearsal pass all succeed.

## Scope

- The shipped Cloudflare R2 online-copy implementation and focused tests.
- The local ignored rehearsal harness and isolated rehearsal buckets.
- No production Cloudflare deployment, production R2 write/delete, or
  production database mutation.

## Evidence

- The virgin rehearsal copied and verified 19,283 immutable objects before
  failing closed on a CopyObject HTTP 404.
- A later read-only comparison found three copied workspace snapshots absent
  from the live source with zero identity mismatches. Each had passed the
  copier's post-copy source HEAD, proving normal source garbage collection
  occurred during the long pass.
- Production code deletes non-current workspace snapshot orphan candidates, so
  a source listing cannot remain deletion-stable for the duration of a bulk
  live copy.
- The focused online-copy suite passes 26 tests, the full Cloudflare Node suite
  passes 2,158 tests, and both Cloudflare and rehearsal-harness typechecks pass.
- ReviewGPT round 4 reported no remaining medium-or-higher finding after
  CopyObject retries and destination-active apply were removed.

## Tasks

1. [x] Add focused failing tests for CopyObject-time and post-copy source deletion
   races while retaining hard failures for ambiguous 404s and identity changes.
2. [x] Implement the smallest create-only churn-tolerant copier behavior.
3. [ ] Run focused tests, typecheck, diff-aware verification, and the required
   ReviewGPT gates.
4. [ ] Open and land the scoped PR.
5. [ ] Provision a fresh isolated destination, rerun the full rehearsal, verify
   convergence and timing, then restore account deletion.
