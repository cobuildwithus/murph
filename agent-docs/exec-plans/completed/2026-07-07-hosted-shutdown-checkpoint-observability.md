# Hosted Shutdown Checkpoint Observability

## Goal

Add metadata-only observability and focused tests for hosted runtime shutdown-triggered idle checkpoints, so deploy-rollout SIGTERM handling and wake-pending context are easier to prove without changing foreground auto-reply priority.

## Constraints

- Keep foreground conversation input and assistant auto-replies ahead of idle checkpoint and maintenance work.
- Do not add a host-owned checkpoint scheduler or new durable runtime state.
- Log only bounded metadata: no payloads, prompts, transcripts, health data, local paths, secrets, or direct identifiers.
- Preserve existing Cloudflare/web deploy compatibility; new log fields must be optional JSON metadata only.
- Run focused tests, `pnpm typecheck`, and a diff-aware verification lane before handoff unless blocked.

## Plan

1. Add a small runtime helper that labels idle-shutdown checkpoint phase logs with the actual checkpoint trigger, and records runtime wake presence as separate metadata.
2. Thread that metadata through shutdown-triggered checkpoint start/done logs and existing persisted checkpoint snapshot lifecycle logs.
3. Add tests proving shutdown metadata is emitted, parsed, and carried to checkpoint requests, runtime wakes do not bypass the idle lower bound, and container SIGTERM aborts the invocation shutdown signal passed into the runtime.
4. Keep post-checkpoint wake/maintenance work out of the exiting invocation after shutdown begins; replacement/runtime recheck owns later work.
5. Review the diff for privacy/scope, run verification, then commit the scoped change.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "hosted runtime shutdown signal|metadata-only phase boundary logs for checkpoint" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "pre-shutdown no-work runtime wake|pending runtime wake after shutdown|waits for the idle window when an external runtime wake has no foreground work" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "pre-shutdown no-work runtime wake|shutdown after an idle-window checkpoint trigger|pending runtime wake after shutdown|waits for the idle window when an external runtime wake has no foreground work" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "pre-shutdown no-work runtime wake|shutdown after an idle-window checkpoint trigger|shutdown after checkpointing returns a due assistant wake|pending runtime wake after shutdown|waits for the idle window when an external runtime wake has no foreground work" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "shutdown while consuming a retained post-checkpoint wake|shutdown during post-checkpoint due assistant import|shutdown after checkpointing returns a due assistant wake|shutdown after an idle-window checkpoint trigger|pre-shutdown no-work runtime wake|pending runtime wake after shutdown|waits for the idle window when an external runtime wake has no foreground work" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "keeps idle-window trigger when a queued runtime wake has no foreground work" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "waits for the idle window when an external runtime wake has no foreground work" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "reports mailbox budget exhaustion only after deferring an overflow item" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "runtime wakes during the final idle checkpoint drain after the checkpoint commits" hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --testNamePattern "carries idle checkpoint trigger metadata" hosted-invocation-bridge.test.ts`
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage --testNamePattern "parses workspace checkpoint contracts" hosted-runtime-control.test.ts`
- `pnpm typecheck`
- `pnpm --filter @murphai/assistant-runtime build`
- `pnpm --dir apps/cloudflare verify`
- `bash scripts/workspace-verify.sh test:diff -- $(git diff --name-only origin/main)`

## Deploy Skew

- Safe deploy order: no tandem deploy is required. The new fields are optional metadata on the existing checkpoint/log paths, so old runners omit them and new web/Cloudflare code accepts absence.
- Gradual Cloudflare rollout: safe with mixed old/new containers. New containers may emit `idleCheckpointTrigger` as `idle_window` or `shutdown_signal` and may emit `runtimeWakePendingAtCheckpoint`; old web/checkpoint parsers treat them as non-critical request/log metadata and the checkpoint still succeeds without trigger persistence.
- `container_rollout=immediate`: not required for this change. A gradual rollout only affects whether the extra trigger appears in logs during the rollout window.
- Rollback floor: any currently deployed runner/web version remains compatible. Rolling back loses the new trigger observability but must not block checkpoints or auto-reply handling.

## State

Completed. Runtime metadata is emitted for shutdown-triggered idle checkpoints, wake-pending context remains separate from the actual checkpoint trigger, post-checkpoint wake/maintenance work is guarded by a live shutdown-aware predicate/signal once shutdown begins, and the production bridge request is covered by focused parser/runtime/bridge/Cloudflare shutdown tests plus the explicit diff verification lane.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
