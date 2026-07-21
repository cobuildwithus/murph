# Conversational low-usage warning

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Replace the standalone low-usage message with a trusted prompt-time signal so
  Murph can mention low usage naturally inside the next ordinary 1:1 or group
  reply.

## Success criteria

- Low remaining capacity never triggers its own outbound message.
- The next accepted conversational turn in both personal and group chats gives
  Murph bounded low-usage context and simple, non-alarming guidance.
- Healthy turns do not receive the context, and exhausted turns retain their
  deterministic explanation and funding handoff because the model cannot run.
- Existing personal and group checkout, accounting, and hard allowance gates
  remain authoritative.

## Scope

- In scope: existing usage-capacity decisions, the shared inbound conversation
  context contract, system-prompt guidance, focused tests, and current behavior
  documentation.
- Out of scope: new schedulers, queues, usage wallets, public accounting
  details, pricing changes, and funding-page redesign.

## Constraints

- Keep usage accounting off the foreground provider-start path.
- Reuse an existing trusted Web-to-runtime input boundary; add persisted state
  only if current accepted-turn state cannot represent the signal correctly.
- Preserve unrelated work and keep edits narrow around active prompt-context
  and usage-notice lanes.

## Tasks

1. Trace the existing allowance admission and mailbox/runtime turn-context path.
2. Remove automatic low-usage delivery and inject low-capacity context into the
   next real personal or group turn.
3. Add prompt guidance, focused regression coverage, and update durable behavior
   docs.
4. Run required verification and completion audits, close the plan with a scoped
   commit, then push, open, review, and land the PR.

## Decisions

- Keep deterministic exhausted notices. Exhausted requests cannot invoke Murph,
  so an organic model-authored explanation is impossible at that point.
- Reuse the current 20% effective-capacity threshold and mailbox allowance
  check. The runtime receives only `low`, never balances or payer details.
- Bind the signal only to fresh conversation items. Consumed replay and system
  work must not produce a user-facing warning.

## Verification

- Focused affected-package tests passed for Web (99 tests), hosted execution,
  assistant runtime, and assistant engine.
- Typechecks passed for Web, hosted execution, assistant runtime, and assistant
  engine.
- `pnpm verify:acceptance` passed, including the production Web build, full Web
  tests, package coverage, app verification, lint, typechecks, generated
  artifacts, and package-boundary checks.
- The required coverage-write audit passed after proving direct/group low and
  healthy behavior, replay/system isolation, trusted-sidecar projection, and
  optional-field compatibility. No production-code gap remained.
- `git diff --check` and the privacy scan passed.
- PR CI and ReviewGPT remain before merge.
Completed: 2026-07-21
