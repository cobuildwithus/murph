# Align browser assertion replay and retention boundaries

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

Persist browser assertion nonces through the full verifier acceptance horizon so
mixed-version cleanup cannot make an accepted assertion replayable.

## Success criteria

- Verification and persisted expiry share one explicit first-invalid boundary.
- Legacy nonce rows remain protected through their former acceptance horizon.
- Exact-boundary and cleanup compatibility tests cover verifier and store behavior.
- Security, architecture, device-sync, and testing documentation agree.
- Focused local checks, exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope: browser assertion verification, nonce persistence/cleanup, focused
  tests, and directly affected durable documentation.
- Out of scope: moving the remaining foreground nonce cleanup transaction; that
  is a separate bounded follow-up.

## Tasks

1. [x] Define and use the shared first-invalid boundary.
2. [x] Persist the full replay-protection horizon and preserve legacy rows.
3. [x] Add focused verifier, store, and mixed-version regression coverage.
4. [x] Align durable security and device-sync documentation.
5. [ ] Commit, push, open the draft PR, and complete CI and ReviewGPT gates.

## Verification

- Focused browser assertion auth and Prisma-store Vitest suites.
- Hosted-web typecheck and focused ESLint.
- Source hygiene, docs drift/gardening, privacy scan, and diff checks.

## Decisions

- Keep cleanup conservative for both legacy and new rows rather than adding a
  schema migration or weakening the exact verifier boundary.
- Defer deletion of the foreground cleanup transaction to a separate PR so this
  compatibility correction remains small and independently reviewable.
Completed: 2026-08-09
