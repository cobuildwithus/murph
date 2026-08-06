# Browser-vault replica retention

## Goal

Stop hosted browser-vault refreshes from retaining every superseded or
unpublished encrypted R2 replica while preserving the currently published
replica through conflicts, timeouts, retries, crashes, and deploy skew.

## Proven production symptom

- The source production bucket contains about 20,400 stale browser-vault
  replicas using about 78 GiB.
- Current database refs describe 106 live replicas using about 130 MB.
- Roughly 16.5 GiB of stale replicas accumulated during the last seven days.
- The runtime writes a unique object before publishing its ref, Web advances
  only the ref, and no production path calls the existing replica deletion
  method.

## Success criteria

- A replica object is durably registered for reference-safe cleanup before it
  can be written to R2.
- The previously published ref is also registered before replacement begins.
- Cleanup deletes only a bound user's replica that is old enough and does not
  match Web's current `browserVaultReplicaRef`.
- The current replica survives publication conflicts, ambiguous responses,
  alarms, retries, and gradual Worker/container rollout.
- Cleanup failures remain retryable without adding another scheduler, queue,
  or product-truth owner.
- Object keys, member identifiers, replica contents, and credentials remain
  absent from logs, tests, docs, and review artifacts.

## Implementation

1. Extend the existing UserRunner orphan-candidate/alarm owner with a narrow
   browser-vault replica candidate type and storage prefix.
2. Register the intended replacement ref and the planned new object before the
   R2 write, using the bound write fence and user namespace.
3. Make alarm cleanup compare candidates with Web's current replica ref before
   deleting, and retain failed candidates for retry.
4. Add focused tests for publication success, conflict, failed writes, current
   ref preservation, deletion retry, and coexistence with snapshot cleanup.
5. Run focused Cloudflare and assistant-runtime verification plus direct
   failure/retry proof.
6. Push an exact candidate, run CI and both required ReviewGPT stages, resolve
   accepted findings, and close this plan with the final scoped commit.

## Operational boundary

This change stops new leakage. Historical production deletion is a separate
destructive operation after the fixed Worker and runner bundle have converged;
it must use authoritative current refs across both cutover buckets and a
reference-safe grace window.

## Progress

- Implemented runner-owned orphan registration for both the planned replica
  and the Web-reported ref it may replace, before the R2 write.
- Extended the existing delayed alarm to clean browser-vault candidates and
  workspace-snapshot candidates from one Web workspace read while preserving
  each current ref and retaining failed deletions for retry.
- Added direct proof for pre-write registration, publish conflicts, the
  65-minute grace window, current-ref preservation, namespace enforcement,
  mixed snapshot/replica cleanup, and R2 deletion retries.
- Corrected the alarm race identified by preliminary specialist review: the
  Durable Object now re-reads a candidate after deletion and removes its
  storage record only when the same candidate is still current.
- Focused Cloudflare and assistant-runtime tests and both affected package
  typechecks pass after merging the latest base branch.
- Full production acceptance passes, including repository guards, package
  coverage and boundaries, Web lint/tests/production build, and Cloudflare
  Node and Workers suites.
- Preliminary specialist ReviewGPT and both final ReviewGPT rounds completed
  with no unresolved findings. The final correction-verification round passed
  on the corrected behavior-bearing head.
- The final documentation-only head remains gated on required exact-head CI
  before merge and protected production deployment.

## State

Implementation and local/review proof are complete. Exact-head CI, merge, and
the protected production deployment remain required operational gates.
Status: completed
Updated: 2026-08-06
Completed: 2026-08-06
