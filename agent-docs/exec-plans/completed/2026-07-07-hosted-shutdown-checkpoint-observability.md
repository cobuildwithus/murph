# Hosted Shutdown Checkpoint Observability

## Goal

Add metadata-only observability and focused tests for hosted runtime shutdown-triggered idle checkpoints, so deploy-rollout SIGTERM handling is easier to prove without changing foreground auto-reply priority.

## Constraints

- Keep foreground conversation input and assistant auto-replies ahead of idle checkpoint and maintenance work.
- Do not add a host-owned checkpoint scheduler or new durable runtime state.
- Log only bounded metadata: no payloads, prompts, transcripts, health data, local paths, secrets, or direct identifiers.
- Preserve existing Cloudflare/web deploy compatibility; new log fields must be optional JSON metadata only.
- Run focused tests, `pnpm typecheck`, and a diff-aware verification lane before handoff unless blocked.

## Plan

1. Add a small runtime helper that labels idle-shutdown checkpoint phase logs with the trigger source.
2. Thread that metadata through shutdown-triggered checkpoint start/done logs and existing persisted checkpoint snapshot lifecycle logs.
3. Add tests proving shutdown metadata is emitted, parsed, and carried to checkpoint requests, and that container SIGTERM aborts the invocation shutdown signal passed into the runtime.
4. Review the diff for privacy/scope, run verification, then commit the scoped change.

## Verification

- Focused assistant-runtime hosted shutdown tests
- Focused Cloudflare container-entrypoint shutdown test
- Focused hosted-execution runtime-control parser test
- `pnpm typecheck`
- `pnpm test:diff` scoped to touched files

## State

Active. Runtime metadata and focused tests patched. `pnpm typecheck`, focused hosted-execution and assistant-runtime tests, and `apps/cloudflare verify` passed. Scoped `test:diff` reached unrelated CLI reverse-dependent failures in `packages/cli/test/cli-expansion-intervention.test.ts` and `packages/cli/test/release-script-coverage-audit.test.ts`.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
