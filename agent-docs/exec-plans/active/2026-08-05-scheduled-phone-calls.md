# Enable phone calls on scheduled turns

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

Allow a canonical private Linq scheduled automation to place the outbound
phone call it requested through the existing hosted phone-call port.

## Proven symptom and root cause

- A recent scheduled-call attempt created no hosted phone-call row, while a
  separate recent call completed through the same provider path.
- The scheduled turn carries the phone-call port and a canonical automation
  occurrence authority, but planning currently exposes `murph.create_phone_call`
  only when the turn has accepted live user input.
- Execution repeats that live-input-only check, so the scheduled occurrence is
  blocked before the hosted Web or phone provider boundary.

## Success criteria

- A direct Linq `automation-cron` turn with an exact canonical occurrence
  authority can see and invoke `murph.create_phone_call` through the existing
  port.
- Scheduled email, Telegram, and group turns remain unavailable because the
  existing Web result owner cannot guarantee completion on their initiating
  route without new persisted routing state.
- The call start remains behind the cron owner's canonical automation, route,
  owner, lifecycle, and pre-tool revalidation.
- Scheduled group calls remain unavailable; their separate delivered-preview
  and later participant-confirmation gate is unchanged.
- Scheduled retries reuse one deterministic request key derived from the exact
  automation occurrence, independent of resident-session or model-brief drift.
- Web replays that exact scheduled occurrence across resident sessions only
  when the new brief exactly matches the first persisted brief; live calls keep
  their existing different-session collision rule.
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
6. Restrict scheduled authority to direct Linq after final review proved that
   email can fail before provider start and Telegram can close the result loop
   on Linq; keep those channels unavailable instead of adding new route state.

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
- After merging the latest `origin/main`, the focused 94-test command and
  Assistant Engine typecheck passed again on the exact candidate.
- A real pinned Codex App Server request capture with synthetic direct and
  group scheduled turns measured the complete selected provider fields
  (`include`, `input`, `parallel_tool_calls`, `text`, `tool_choice`, and
  `tools`) using `gpt-tokenizer` 3.4.0 `o200k_harmony`. The direct request grew
  from 20,594 to 21,052 tokens (+458, +2.2239%) and from 95,165 to 97,373
  UTF-8 bytes (+2,208) because it gained the phone tool. The scheduled group
  request remained exactly unchanged at 16,902 tokens and 78,987 bytes.
- The preliminary specialist pass found one accepted high-severity retry gap:
  the initial scheduled key survived a resident-session change but Web rejected
  that replay, while brief drift created a different key and could admit a
  second call. The correction gives each occurrence one exact scheduled key,
  lets Web replay that key across resident sessions, and still requires the
  first encrypted brief to match exactly.
- The corrected focused suites passed: Assistant Engine 94 tests, Hosted
  Execution phone-call contracts 12 tests, Web phone-call service 51 tests,
  and runner bundle budget policy 34 tests. Assistant Engine, Hosted Execution,
  and Web typechecks passed.
- Exact-head CI on the first-reviewed head passed every job except runner bundle
  assembly, where the intended graph grew 4,465 bytes beyond the prior total
  ceiling. The documented baseline was ratcheted to the higher measured macOS
  total while preserving the 32 KiB allowance and forbidden-import guards; a
  production runner bundle rebuild then passed at 10,275,648 bytes against the
  10,308,229-byte budget.
- Final ReviewGPT round 2 accepted the occurrence-idempotency correction and
  found one separate completion-route gap: scheduled email can lack a Web
  notification destination, while a Telegram occurrence can resolve its final
  call result to Linq. Regression-first Assistant tests failed in all four new
  email/Telegram cases before the channel gate, then the focused planning and
  authority suites passed 98 tests after exact direct-Linq scoping; Assistant
  Engine typecheck also passed.
- The corrected production runner bundle passed at 10,275,785 bytes against the
  10,308,229-byte total budget, and the 34-test bundle policy suite plus agent
  docs drift and diff checks passed.
