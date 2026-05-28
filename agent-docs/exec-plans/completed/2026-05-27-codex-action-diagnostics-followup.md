# Codex action diagnostics follow-up

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Fix final review findings in the Codex action diagnostics primitive while
  preserving the metadata-only, low-latency design.

## Success criteria

- Diagnostics do no reducer work when no trace sink exists.
- Per-turn reducer state remains bounded and dedupes repeated action events.
- Token usage is scoped to the active turn when a turn id is available.
- Failed Codex turns still emit one metadata-only diagnostic trace before the
  turn failure propagates.
- Focused tests cover the follow-up edge cases.

## Scope

- In scope:
  - `packages/assistant-engine` diagnostics reducer and app-server emission.
  - Focused assistant-engine tests for the follow-up edge cases.
- Out of scope:
  - Hosted parser schema changes.
  - New telemetry storage, queues, workers, or raw payload logging.

## Verification

- Commands to run:
  - `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant-codex/action-diagnostics.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts`
Completed: 2026-05-27
