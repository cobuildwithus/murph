# Stranded Provider Usage Recovery

## Goal

Ensure successful provider usage observed during a hosted assistant run is not lost when the assistant phase fails before the normal post-checkpoint usage export path runs.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/usage.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- Focused runtime-state/runtime-log helpers only if needed.

## Constraints

- Preserve existing pending usage file semantics and web usage import ownership.
- Keep runtime issues and logs redacted and metadata-only.
- Do not touch unrelated in-flight usage metadata rows except to work with their current test fixture shape.

## Verification

- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm typecheck` unless blocked by unrelated active rows.
- Required completion audits for hosted runtime reliability/persisted-state behavior.

## Status

Active.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
