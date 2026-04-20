# Greenfield Simplification Cleanups

## Goal

Land five behavior-preserving simplifications in Cloudflare, assistant-runtime, and vault-usecases while preserving current hosted execution behavior and avoiding overlap regressions with existing dirty-tree work.

## Scope

- delete dead hosted-runner helper surface that no longer has runtime callers
- make runner web control explicitly POST-only without changing today's rejected GET behavior
- replace repeated hosted run elapsed-time helpers with one shared hosted-runtime utility
- extract shared raw import manifest reading for vault-usecases manifest commands
- remove the no-op loopback-proxy parameter and collapse duplicate header-copy helpers

## Guardrails

- preserve existing behavior and existing error codes/messages
- do not broaden into hosted-wake, finalize-recovery, or unrelated runner cleanup
- preserve unrelated in-flight edits in dirty files, especially `apps/cloudflare/src/runner-container.ts` and `packages/assistant-runtime/src/hosted-runtime/**`

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/src/local-loopback-proxy.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/user-runner/runner-wake-processor.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/src/hosted-runtime/typing.ts packages/vault-usecases/src/usecases/document-meal-read.ts packages/vault-usecases/src/usecases/measurement-read.ts packages/vault-usecases/src/usecases/workout-read.ts packages/vault-usecases/src/usecases/shared.ts`

## Notes

- `packages/assistant-runtime/src/hosted-runtime/summary.ts` and `apps/cloudflare/src/runner-outbound/codec.ts` currently appear referenced only by tests, not runtime callers; remove stale test coverage if the dead surface is deleted.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
