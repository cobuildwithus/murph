# Thread Container Member Access

Status: completed
Updated: 2026-07-06

## Why

Participant-authorized hosted group threads must be able to wake, restore,
decrypt, and reply even when the thread-container owner is inactive. Existing
fixes routed several gates through participant-aware access, but other hot-path
gates still resolved thread-container access as owner-only.

## Scope

- Centralize participant-aware thread-container access in
  `readActiveHostedMemberAccess`.
- Keep usage and budget ownership anchored to the owner member.
- Preserve owner-active short-circuit behavior and suspension fail-closed
  behavior.
- Fix roster reconciliation so an over-cap provider roster never soft-removes
  still-active participants beyond the cap.
- Add focused tests for Temporal reconciliation facts, runtime crypto-context
  authorization, and over-cap participant reconciliation.

## Non-Goals

- No real-time departure machinery for stale participant rows.
- No new persisted access state.
- No change to billing/usage ownership semantics.

## Verification

- Focused web tests for access gates and roster cap behavior.
- `pnpm --dir apps/web prisma:generate`.
- `pnpm --dir apps/web typecheck`.
- Additional package checks only if touched files require them.
Completed: 2026-07-06
