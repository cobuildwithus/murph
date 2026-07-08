# Strict Idle Checkpoint Delay

Status: completed
Updated: 2026-07-05

## Goal

Hosted runtime checkpoints must not start before the configured idle checkpoint
delay after foreground dirty work. Projected wakes, due assistant wakes,
mailbox budget exhaustion, and deferred durable checkpoint follow-ups may
preserve wake metadata, but they must not pull the checkpoint earlier than the
idle timer.

## Scope

- Delete early-checkpoint branches from `packages/assistant-runtime/src/hosted-runtime.ts`.
- Update focused hosted-runtime regressions to prove strict idle-delay behavior.
- Record the invariant in `docs/contracts/00-invariants.md` and align the
  hosted runtime protocol reference/index wording.

## Verification

- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts docs/contracts/00-invariants.md agent-docs/references/hosted-runtime-protocol.md agent-docs/index.md` passed, including `packages/assistant-runtime` typecheck/tests and `apps/cloudflare` verify.
- `git diff --check` passed.
- Diff privacy scan passed.
Completed: 2026-07-05
