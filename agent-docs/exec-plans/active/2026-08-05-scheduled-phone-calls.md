# Enable phone calls on scheduled turns

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

Allow a canonical private scheduled automation to place the outbound phone
call it requested through the existing hosted phone-call port.

## Proven symptom and root cause

- A recent scheduled-call attempt created no hosted phone-call row, while a
  separate recent call completed through the same provider path.
- The scheduled turn carries the phone-call port and a canonical automation
  occurrence authority, but planning currently exposes `murph.create_phone_call`
  only when the turn has accepted live user input.
- Execution repeats that live-input-only check, so the scheduled occurrence is
  blocked before the hosted Web or phone provider boundary.

## Success criteria

- A direct `automation-cron` turn with an exact canonical occurrence authority
  can see and invoke `murph.create_phone_call` through the existing port.
- The call start remains behind the cron owner's canonical automation, route,
  owner, lifecycle, and pre-tool revalidation.
- Scheduled group calls remain unavailable; their separate delivered-preview
  and later participant-confirmation gate is unchanged.
- Scheduled retries reuse a deterministic request key derived from the exact
  automation occurrence and bounded call brief.
- Live user calls preserve their existing request-key and requester authority.
- Focused tests, Assistant Engine typecheck, exact-head CI, and required
  ReviewGPT gates pass without private production evidence entering artifacts.

## Tasks

1. Add a focused planning regression that proves direct scheduled availability
   and scheduled group denial.
2. Add a focused execution regression for exact scheduled authority,
   deterministic replay identity, and missing-authority denial.
3. Implement the smallest dedicated scheduled phone-call authority scope in
   the existing hosted tool context and use it only when no live user-action
   scope exists.
4. Run focused Assistant Engine tests and typecheck, then inspect the diff for
   privacy, ownership, and unnecessary complexity.
5. Push the exact candidate, run required CI and both ReviewGPT stages, resolve
   accepted findings, and close this plan with the final scoped commit.

## Verification log

- The focused planning regression failed before implementation because the
  direct scheduled turn omitted `create_phone_call`; the scheduled group case
  remained denied.
- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts test/assistant-phone-calls.test.ts
  test/assistant-codex-turn-planning.test.ts --no-coverage` passed: 2 files,
  94 tests.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- The unbounded package test command hit the default 4 GiB Node heap in an
  unrelated local-service worker. The repository's canonical Assistant Engine
  profile passed: `NODE_OPTIONS=--max-old-space-size=6144
  MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/assistant-engine test` ran
  203 files with 3,167 passing and 38 skipped tests.
