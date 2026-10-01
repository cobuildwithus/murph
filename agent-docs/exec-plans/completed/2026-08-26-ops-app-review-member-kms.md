# Keep Privy and KMS work outside the Ops reviewer transaction

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

Keep the Ops App Review member-resolution transaction short and database-only.
Resolve the verified Privy identity, member snapshot, generated member ID, and
control-domain root before opening the transaction, then pass those prepared
values into the existing transactional identity owner.

Success means:

- no Privy or hosted-domain-root provider operation runs while the member
  resolution transaction owns a database connection;
- an existing member and a newly generated member ID use matching prepared
  control roots;
- one exact preparation-mismatch race causes one fresh re-prepare and retry;
- other identity conflicts fail closed without retry or activation side effects;
- dry-run and Privy test-user creation behavior remain unchanged; and
- the obsolete provider-capable transaction wrapper is deleted once no caller
  remains.

## Product UX

Effort: Fix. There is no visible product change. The operator keeps the same
dry-run/apply summaries and recovery behavior, while a slow Privy or KMS call no
longer holds a pooled database connection.

Affected people are the operator preparing an App Review account and members
sharing the same hosted Web database pool. Existing conflicts and repeated
preparation races continue to fail closed; there is no new retry queue, state
owner, or user-facing recovery surface.

## Implementation

1. Replace the legacy member wrapper at the Ops caller with split-phase
   orchestration around the existing transactional resolution API.
2. Reuse the domain-root cache/provider guard and the canonical onboarding
   transaction options; retry only the exact stale-preparation error once with
   a fresh cache.
3. Delete the now-unused wrapper and add focused regression coverage for
   new/existing members, delayed providers, the bounded race, conflicts,
   dry-run, and Privy create/recovery paths.

## Verification

- Run the focused Ops App Review service suite.
- Run the hosted Web typecheck and focused lint.
- Run docs drift, diff checks, and caller/identifier scans.
- Push a draft PR, then run preliminary specialist and sensitive final
  ReviewGPT gates concurrently with required exact-head CI.

## Deployment

This is a Web-only internal control-flow change with no schema, environment, or
Cloudflare contract change. Deploy through the ordinary Web pipeline and verify
the Ops flow remains healthy; no tandem deploy is required.
Completed: 2026-08-26
