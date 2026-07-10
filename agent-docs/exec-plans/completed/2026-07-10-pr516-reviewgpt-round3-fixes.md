# Harden connection-epoch guards after PR review

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Preserve Garmin historical recovery while making seeded callbacks and
  disconnect warnings consistent with the existing immutable connection epoch.

## Success criteria

- Authenticated early webhooks cannot invalidate a legitimate seeded callback.
- Seeded callbacks remain compatible with already-issued OAuth state and reject
  a genuinely replaced connection epoch.
- Provider-revoke failures classify historical-reset guidance from the same
  locked snapshot that finalizes the disconnect.
- A late connection-established hook cannot recreate connected source, signal,
  or wake state after disconnect or replacement of the connection epoch.
- No new table, queue, service, lifecycle manager, or persisted state is added.
- Focused regressions, affected-workspace verification, completion audits, PR
  ReviewGPT, and final CI pass.

## Scope

- Seeded setup epoch guards, setup cleanup guards, disconnect warning
  classification, focused tests, and any directly matching durable contract
  wording.
- No provider-side revocation protocol, synthetic historical data, new
  background work, or unrelated device-connect behavior.

## Decisions

- Use `connectedAt`, the existing immutable connection epoch, instead of the
  mutable row revision for seeded callback and cleanup ownership.
- Derive the seeded epoch from the OAuth state creation time already written in
  the same seed operation; delete the redundant state metadata revision.
- Carry only the sanitized provider failure across remote revocation. Derive
  reset-specific guidance inside the existing final mutation lock and
  transaction from fresh account and source state.
- Reuse the same mutation lock and immutable epoch for connection-established
  source, signal, and mailbox persistence; skip stale hook work.
- Accept the pre-existing provider-side revoke/reconnect race as a provider API
  limitation; do not add a durable revocation state machine without provider
  epoch support or concrete product evidence.

## Tasks

1. Reproduce both review signals and confirm hosted/SQLite parity.
2. Replace mutable revision guards with the existing connection epoch and add
   compatibility/race regressions.
3. Move revoke-warning classification and connection-established persistence
   into their matching existing mutation locks.
4. Run focused checks, all routed audits, affected-workspace verification,
   scoped commit/push, ReviewGPT, and final PR checks.

## Verification

- Focused device-sync and web tests plus their package typechecks.
- Full affected-workspace `pnpm test:diff` gate.
- Security/privacy, coverage-write, state-consistency, and simplicity audits.
- Diff/privacy scan, ReviewGPT against the final pushed head, and final CI.

## Verification results

- Focused device-sync tests: 95 passed.
- Focused web Prisma/wake tests: 89 passed.
- Device-sync coverage suite: 771 passed; 89.1% statements and 79.8%
  branches.
- Full affected-workspace gate passed, including all 14 affected package
  typechecks, dependency and boundary guards, web lint/dev smoke/production
  build, 4,237 web tests, and 1,690 Cloudflare tests.
- Coverage-write audit found no unresolved gaps.
- Security/privacy audit found no actionable critical, high, or medium issues;
  the added-line privacy scan was clean.
- State-consistency review found and resolved a late connection-established
  hook race by reusing the existing connection mutation lock and epoch guard.
- Simplicity review confirmed the correction adds no persisted state or new
  lifecycle abstraction.
- `git diff --check` passed.
Completed: 2026-07-10
