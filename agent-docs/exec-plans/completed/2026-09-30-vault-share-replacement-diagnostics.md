# Distinguish vault-share replacement deferrals

Status: completed
Created: 2026-09-30

## Outcome and invariant

Distinguish the existing replacement-time deferral branches without changing
delivery, access, version, grant, deadline, transaction, or retry behavior.
Web remains the sole projection owner. No new state or requests are needed.

## Evidence and scope

The existing route diagnostic identifies replacement-time rejection but its
store result collapses inactive access, a source-workspace version mismatch,
and an unapplied conditional share update. Current state cannot recover which
branch ran during an earlier request. Synthetic cases can prove these distinct
paths while preserving the existing response and write guards.

Extend the existing failure observation with closed metadata derived at its
owner. Emit no identifiers, payloads, versions, timestamps, errors, or scope
values. Keep the existing request-level volume bound and make observation
failure harmless. This is telemetry only; no member-visible behavior changes.

## Work

1. Review current owner code and focused baseline proof; complete sweep coverage.
2. Have ReviewGPT implement the minimal observation and regression proof.
3. Inspect privacy, call order, transaction lifetime, and runtime cost; run
   focused tests, typecheck, complexity and documentation checks.
4. Commit and open a scoped PR; final ReviewGPT and exact-head required CI.
5. Merge/deploy only under the telemetry exception and canonical admission;
   read back the serving revision and naturally occurring observations.

## Deployment

Web-only additive diagnostic metadata. Existing caller and response contracts
are unchanged. No schema migration, receiver-first rollout, access change, or
Cloudflare deployment. Natural traffic only; absence of events is unexercised
telemetry, not proof of historical recovery.

## Verification

- ReviewGPT implemented the two existing owners and focused store/route proof.
  Parent review retained the closed observer and corrected only a test-double
  type seam to match the existing store fixture convention.
- Focused store and route suites: 92 passing tests. The 15 new branch-observation
  scenarios fail against base source and pass against the candidate.
- Web typecheck passes. Complexity guard passes: store maximum remains 19;
  the existing route handler remains 26 with unchanged debt. Its existing
  failure precedence and sequential destination loop remain the simplest owner.
- Complete parent diff review and whitespace checks pass. No production content
  appears in source, fixtures, docs, or review input.
- Optional local real-PostgreSQL deadline proof could not reach its behavior
  because the shared test database lacks a current workspace column. Its
  current-schema hosted CI result remains a required evidence boundary.

## Release follow-up

Final ReviewGPT and exact-head required CI are pending on the scoped pushed PR.
Only after both pass may the telemetry-only change use canonical Web admission.
Read back the actual production alias revision, then query existing warnings by
`schema`, `reason`, and optional `replacementDeferralReason`. Absence of natural
traffic leaves attribution unexercised and historical outcomes unresolved.
Updated: 2026-09-30
Completed: 2026-09-30
