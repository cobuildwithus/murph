# Codex Live Turn Steering

## Goal

Fix the Codex App Server active-turn gap so late accepted user input can steer
the live Codex app-server turn while it is still running, instead of waiting for
the provider request to finish and issuing a separate provider request.

Success criteria:

- A Codex app-server provider turn has an explicit live runner/session boundary.
- Late input is fenced by Murph session id, Murph turn id, Codex thread id, and
  Codex turn id before `turn/steer` is written.
- Local active-turn steering can reach the running Codex provider turn.
- If steering is unavailable, stale, or cancelled, the runtime fails closed or
  falls back only through the existing accepted-input continuation path.
- Focused tests prove one app-server process/session can receive late input
  during an active turn.

## Constraints

- Work only in the current checkout and preserve unrelated dirty work.
- Do not touch hosted-runtime env, Cloudflare, assistant automation routing,
  docs/smoke files, or Codex config/images unless absolutely required.
- Do not write local usernames, home paths, direct identifiers, secrets, raw
  authorization headers, or provider credentials into files.
- Do not commit.

## State

- Focused verified, no commit requested. Codex app-server turns now expose a
  live turn handle, local-service registers that handle with the active-turn
  controller, successful late manual steering is marked as provider-visible
  without issuing a second provider request, and the provider-request journal is
  widened after live-steered accepted inputs are appended.
- Root `pnpm typecheck` remains blocked by unrelated `apps/web` experiment-detail
  type errors outside this task.

## Working Set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/app-server-rpc.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-controller.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
