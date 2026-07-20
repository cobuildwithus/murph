# PR 798 ReviewGPT round 1 correction

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Keep the automatic Stripe-return continuation owned exclusively by the
  Settings Start Pulse route that can issue its member/session-bound claim.

## Scope

- In scope: the shared Start Pulse service input, route opt-in, focused service
  and route tests, product contract, and PR disclosure.
- Out of scope: automatic conversational handoffs, new persisted authority,
  subscription-tool redesign, schema, or billing lifecycle changes.

## Proven finding

- ReviewGPT round 1 showed that `start_pulse_now` and the paused
  `continue_pulse` recovery path share the billing service but cannot issue the
  route-owned browser cookie. Inferring browser continuation from `timing`
  therefore marked unowned handoffs and could combine a surviving canceled-flow
  cookie with a later continue-at-trial-end choice.

## Tasks

1. Make browser payment-method continuation an explicit default-off start input.
2. Opt in only from `POST /api/settings/billing/start-paid-pulse` and thread the
   value through the paused helper.
3. Prove browser-route opt-in and unmarked conversational start/continue paths.
4. Run verification, commit/push, update PR disclosure/current shape, and start
   ReviewGPT correction round 2 with CI in parallel.

## Verification

- Focused billing service/route tests: 6 files, 135 tests passed.
- `apps/web` typecheck and targeted ESLint passed.
- Coverage re-audit found no unresolved gaps and added a stable-boundary
  assertion for conversational `start_pulse_now`.
- `pnpm test:diff` passed dependency, boundary, and security guards; TypeScript;
  471 web test files with 5,902 tests passed and 148 skipped; ESLint with zero
  errors and eight unrelated existing warnings; dev smoke; and the Next.js
  production build.
- Pending exact-head preflight, ReviewGPT round 2, and required GitHub CI after
  the correction commit is pushed.
Completed: 2026-07-20
