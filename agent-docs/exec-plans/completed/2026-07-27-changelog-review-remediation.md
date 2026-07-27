# Correct the July 26 access-recovery changelog claim

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Narrow the already-published July 26 access-recovery note to the paused and
  lapsed billing states that share a visible recovery path across iMessage and
  Telegram.

## Scope

- In scope:
  - `apps/web/src/lib/changelog.ts`
  - focused changelog registry coverage
- Out of scope:
  - changing suspended-account runtime behavior
  - adding another delivery or recovery owner

## Evidence

- Final ReviewGPT round 1 found that the published phrase “otherwise blocked”
  included suspended iMessage members.
- The Linq planner intentionally returns an ignored `suspended-member` plan
  before visible access recovery, while the Telegram wrapper handles that
  provider-specific state.

## Verification

- Focused changelog registry, page, and feed tests.
- Targeted web typecheck and lint.
- Canonical diff verification for the remediation paths.
- Final ReviewGPT correction-verification round.

## Completion evidence

- Focused changelog, page, feed, and design tests passed: 33 tests.
- Targeted web typecheck and lint passed.
- Canonical `pnpm test:diff ...` passed: 552 web test files, 6,881 tests,
  lint with zero errors, dev smoke, typecheck, and production build.
- Public copy now names only paused and lapsed billing-access states and
  explicitly preserves channel-specific suspended-account handling.
Completed: 2026-07-27
