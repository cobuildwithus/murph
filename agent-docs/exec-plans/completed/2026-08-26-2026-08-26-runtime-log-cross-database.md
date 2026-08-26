# Eliminate isolated runtime-log cross-database checkout

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep isolated runtime-log clients available when the primary database is
  delayed, without weakening account-deletion convergence or adding another
  runtime owner.

## Success criteria

- Primary member authority is resolved before an isolated client is checked
  out.
- A prepared append cannot recreate diagnostics after isolated account cleanup
  commits.
- Append-first and deletion-first races converge to zero rows after deletion.
- The isolated schema stores no raw member identifier and retains bounded
  statement and pool behavior.
- Focused unit, migration-shape, typecheck, and opt-in PostgreSQL concurrency
  proof pass.

## Scope

- In scope: the isolated runtime-log store and schema, its additive migration,
  focused tests, and the directly owning runtime-log documentation/test map.
- Out of scope: primary member/account-deletion state machines, queues,
  cross-database replication or joins, service extraction, capacity changes,
  and unrelated transaction-audit findings.

## Constraints

- Technical constraints: use the existing subject key and advisory lock; any
  new isolated fact must be monotonic, privacy-minimal, and safe under retries,
  timeouts, mixed versions, and rollback.
- Product/process constraints: first obtain a separate ReviewGPT
  agree-or-reject implementation result; apply only an inspected valid patch;
  keep the PR draft and do not merge it.

## Risks and mitigations

1. Risk: moving the primary read before the isolated lock allows an already
   authorized append to race behind deletion.
   Mitigation: fence the final isolated insert under the existing subject lock
   with the smallest monotonic deletion fact that survives replay.
2. Risk: a rolling deploy or rollback bypasses the new fence.
   Mitigation: keep the migration additive, preserve old append semantics, and
   document and test the required migration-before-Web deployment order.
3. Risk: permanent state becomes a second lifecycle owner or contains member
   identity.
   Mitigation: store only the existing opaque subject digest and never clear a
   deletion fence.

## Tasks

1. Verify current transaction and account-deletion ordering against source and
   focused tests.
2. Capture and inspect the separate ReviewGPT implementation disposition and
   patch artifact.
3. Apply the smallest valid owner-local change and update direct contract
   documentation.
4. Prove checkout, race, retry, timeout, schema, and migration behavior locally.
5. Commit, push, open a draft PR, and start exact-head specialist/final review
   with CI.

## Decisions

- Reuse the existing opaque subject key and isolated advisory-lock owner.
- Reject a queue, generic state machine, cross-database copy/join, or service.
- Split delivery into two pull requests because a final append can race a
  pre-fence cleanup writer during a rolling deploy. The compatibility pull
  request must deploy and every older Web function must drain before the final
  authority-before-checkout pull request may deploy.

## Verification

- Commands to run: focused hosted-runtime-log unit and migration tests; the
  opt-in local-PostgreSQL runtime-log concurrency suite; hosted Web typecheck;
  Prisma runtime-log schema validation; `git diff --check`.
- Expected outcomes: no isolated checkout before primary authority completes;
  two-client saturation proof remains available; deletion wins both race
  orderings; retries and timeouts preserve monotonic deletion; schema and
  types remain valid.

## Results

- ReviewGPT agreed with the issue and supplied the implementation as two
  commits. The exact 52,704-byte patch artifact matched its declared SHA-256
  before inspection or application.
- Compatibility commit proof: 22 focused tests, 8 real-PostgreSQL tests, Web
  typecheck, isolated Prisma validation, docs drift, and diff checks passed.
- Final stacked commit proof: 23 focused tests, 10 real-PostgreSQL tests, Web
  typecheck, docs drift, and diff checks passed.
- The real-PostgreSQL final proof covers three stalled primary reads with an
  isolated pool maximum of two and zero checkout, append-first deletion,
  deletion-first completion in the pre-check gap, timeout rollback, and
  repeated idempotent deletion.
Completed: 2026-08-26
