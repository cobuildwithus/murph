# Simplify device and clinical state owners

## Outcome and invariants

Remove retired local wearable control capabilities and duplicated ingestion paths.
Keep Web connection authority, current companion authentication, source lifecycle
fences, durable accepted work and canonical import atomicity. No production mutation.

## Evidence and owners

The configured provider factory constructs Junction only, using provider-config
credentials. Web owns public ingress through Prisma; the hosted worker's public
ingress facade has no production callers. Junction currently selects two reconcile
algorithms by presence of a yield callback. Clinical outcome counters duplicate the
frozen receipt, and no current producer writes the importing phase.

## Plan

1. Remove local token export/refresh/heartbeat routes and their service methods;
   retain shared authentication and still-used historical credential cleanup.
2. Remove worker public-ingress composition and its unused local ingress stores;
   preserve finite worker scheduling and account/source/job ownership.
3. Use one bounded Junction reconcile path and test yielding, retry and cold progress.
4. Derive clinical counts from the outcome receipt; remove current importing phase
   only with compatible historical normalization and reader proof.
5. Retire old cursor formats only after supported durable restore evidence proves
   they cannot remain. Otherwise document the exact removal gate and retain readers.
6. Run focused tests, affected typechecks and complexity checks, inspect privacy
   and the complete diff, then create a scoped draft PR for parent completion.

## Product UX

Internal architecture simplification. Supported Junction and companion flows must
remain unchanged. Retired local-daemon capability routes cease to exist.

## Validation

Passed: 357 Junction history/resource/continuation/empty-source/hosted-runtime
checks, including callback absent/present and coupled sleep import ownership;
141 clinical projection/retrieval/UI/contract checks; 41 shared session and
Messages scope checks; 34 PostgreSQL device cleanup, clinical deletion and exact
migration checks. The PostgreSQL lane used a task-owned loopback test database.
The worker service/store/public-ingress/Junction-webhook/export/boundary suites
passed 353 tests; the final source-arrival/schema suites passed 81. Web and
device-syncd typechecks pass. Final assistant consumer suites pass 180 tests and
the assistant typecheck passes after deleting the last unused worker config and
receipt setters. Web runtime authority passed 89 tests and maintenance passed 167.
Complexity, docs gardening and docs drift checks pass. Complexity debt decreased
by 17; remaining listed hotspots preserve live ownership and import behavior.

## Decisions and gates

- Historical token cleanup helpers shared by hosted wake/account deletion remain
  until their actual callers retire; deleting HTTP capabilities does not drop data.
- Old progress envelopes can survive in cold checkpoints. No age-based assumption
  substitutes for drain proof. Physical column drops likewise require rollout order.
- Dependencies installed with the frozen lockfile offline; Frog list reviewed.
- Four cleanup findings implemented; worker fixtures now use hosted hydration.
  The fifth (old cursor envelopes and authority hint) remains explicitly gated
  by supported checkpoint drain/restore evidence, documented in the device owner.
- Clinical columns use the existing postdeploy exact-alias/prior-function-drain
  contract lane. The new reader is the rollback floor after contraction.
- Git history proves the original and later needs-reauth outcome writers store
  scalar counts and receipt atomically; no scalar-only producer needs backfill.
  Historical and current Web Workflow dependency graphs do not reach clinical
  retrieval rows. Before the prior-function drain, an old scalar reader can
  briefly show stale counts for a new receipt; current readers stay correct.
- Token-refresh claim/release writers and their exclusive tests are deleted.
  Historical lease and credential cleanup remain; real cleanup tests seed old
  leases directly. Shared pairing/revocation and scoped bearer rejection remain.

## Handoff

Implementation and local verification are complete for the four supported
deletions. The old cursor/authority-hint reader remains until the documented
checkpoint support floor can be proved. Draft PR, required CI, final ReviewGPT,
merge and deployment are owned by the parent completion lane. No production
diagnostics, data mutation, credential access, deployment or rollback occurred.
Status: completed
Updated: 2026-11-10
Completed: 2026-11-10
