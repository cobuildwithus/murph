# Telegram Voice Memos

## Goal

Support generated assistant voice memos on Telegram without storing generated
audio bytes in Murph runtime state and without merging or pushing anything to
`main`.

## Scope

- Extend assistant response media contracts so a voice memo can be backed by a
  Linq attachment id or by a Telegram delivery-time generation descriptor.
- Allow Telegram to advertise and deliver `voice_memo` response media.
- Generate the Telegram audio at delivery time from bounded transcript/config
  metadata, send it through the Telegram Bot API voice-message endpoint, and
  keep the outbox payload metadata-only.
- Preserve existing Linq voice memo behavior.
- Add focused regression coverage for schema, tool availability, Telegram
  runtime send behavior, hosted side-effect parsing, and hosted dispatch.

## Constraints

- Do not write generated audio bytes, provider request bodies, secrets, real
  identifiers, or local absolute paths into committed artifacts.
- Keep the implementation narrow; do not introduce public audio storage, a new
  queue, or a second delivery owner.
- Treat Telegram voice memo delivery as non-idempotent after provider dispatch,
  matching the existing voice memo safety model.
- Branch/PR is allowed; `main` must not be pushed to or merged tonight.

## Verification Plan

- Focused package tests for `assistant-engine`, `operator-config`,
  `hosted-execution`, `assistant-runtime`, and Cloudflare egress policy.
- `pnpm typecheck`.
- `pnpm test:diff` for the touched files if runtime permits, otherwise record
  the highest-signal focused commands and any unrelated blocker.

## State

- Root cause proven: current voice memo media is Linq-only, Telegram advertises
  no voice memo support, hosted side-effect parsing requires
  `transportRefs.linq`, and Telegram runtime lacks `sendVoice`.
- Implementation complete on the task branch: response media contracts allow
  Telegram delivery-time generation refs; Telegram advertises and delivers
  `voice_memo`; hosted dispatch carries the required Telegram/ElevenLabs env;
  Cloudflare egress allows Telegram `sendVoice`.
- ReviewGPT architecture input received: the preferred long-term design is a
  Murph-owned content-addressed voice memo blob store, with Linq and Telegram as
  delivery-time projections. That is a larger migration across provider tool
  execution, outbox dispatch, hosted snapshot/restore, and retention, so this
  branch keeps the narrow bug fix and documents the follow-up direction.
- Verification:
  - `pnpm typecheck` passed.
  - Focused package tests for assistant-engine, assistant-runtime,
    hosted-execution, operator-config, and Cloudflare egress passed.
  - `pnpm test:diff` passed the relevant hosted/channel package tests and
    failed later in `apps/web verify` on an unrelated landing-page auth-label
    expectation in `apps/web/test/page.test.ts`; this branch does not touch
    `apps/web`.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
