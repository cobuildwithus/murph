# Restore the growth dashboard for legacy Telegram group messages

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Restore the authenticated growth dashboard when its 30-day activity window
  includes a legacy Telegram group message that cannot be attributed to a
  sender.

## Success criteria

- The growth dashboard ignores only legacy Telegram group messages without
  usable sender evidence.
- Attributable Telegram and Linq group senders continue to contribute to WAU
  and MAU.
- Payload decryption, mailbox ownership, channel validation, and ambiguous
  identity failures remain fail-closed.
- Focused tests, the canonical diff test lane, acceptance verification, and
  required completion reviews pass.

## Scope

- In scope:
  - Growth-metric decoding and attribution for legacy Telegram group messages.
  - Focused regression coverage.
- Out of scope:
  - Rewriting historical mailbox payloads.
  - Changing the growth scorecard layout or metric definitions.
  - Relaxing mailbox-integrity or identity-ambiguity checks.

## Constraints

- Technical constraints:
  - A missing sender cannot be counted or mapped to a thread container without
    inventing a human identity.
  - Current sender-member evidence remains the preferred stable identity.
- Product/process constraints:
  - Preserve the existing growth scorecard and its personal-plus-group metric
    semantics.
  - Keep the correction narrow and avoid new state or dependencies.

## Risks and mitigations

1. Risk: Catching all decode or attribution errors could hide tampering or
   corrupt mailbox state.
   Mitigation: Return no metric evidence only for a parsed Telegram group wake
   whose sender identity is absent; retain every other strict failure.
2. Risk: Mapping an unattributable row to its thread container would inflate
   activity with a synthetic account.
   Mitigation: Omit the row from active-user sets rather than manufacturing an
   identity.

## Tasks

1. [x] Add a focused regression that reproduces the legacy missing-sender
   payload.
2. [x] Make sender evidence optional only for that legacy Telegram case.
3. [x] Run scoped and canonical verification.
4. Complete the required specialist review, commit, push, and open a PR.

## Decisions

- Production runtime evidence identified a legacy Telegram group sender
  validation error on the authenticated growth route.
- The fix is data robustness only; it does not change visual presentation, so
  no design-catalog component or screenshot is required.

## Verification

- Commands to run:
  - `pnpm --dir apps/web test:prepared test/hosted-ops-growth.test.ts`.
  - `pnpm test:diff` for the changed implementation, test, and plan paths.
  - `pnpm verify:acceptance`.
  - Required agent-doc and frontend-design-proof guards selected by the
    canonical workflow.
- Expected outcomes:
  - Missing-sender legacy Telegram rows contribute zero activity and do not
    prevent the dashboard from rendering.
  - All valid sender, trust-boundary, and existing dashboard tests remain green.
- Results:
  - The focused test failed before the implementation at the production error,
    then passed with all 27 growth tests.
  - `pnpm test:diff ...` passed, including 6,866 web tests, typecheck, lint with
    zero errors, dev smoke, and the production build.
  - `pnpm verify:acceptance` passed its workspace coverage, app, package
    boundary, hygiene, typecheck, and production-build lanes.
