# Simplify Codex subagent routing

Status: completed
Created: 2026-06-30
Updated: 2026-06-30

## Goal

- Fix Murph hosted Codex v2 subagent result loss by deleting wrapper-side
  stale/idle stream policing that can poison the resident Codex app-server
  between turns.
- Preserve the small boundaries Murph actually owns: current parent-turn output,
  parent-thread dynamic tool side effects, JSON-RPC response routing, idle
  compaction, and hosted process isolation.
- Keep the solution deletion-first: no durable subagent mailbox, no scheduler,
  no new process manager, no duplicated Codex protocol state machine.

## Success criteria

- Off-turn Codex JSON notifications no longer poison/kill the warm app-server.
- Foreign/subagent thread server requests are denied so children do not hang,
  but they do not mutate parent turn output or execute parent dynamic tools.
- Parent-thread current turn handling and idle compaction still work.
- Hosted container cleanup preserves the verified Codex app-server process tree
  and recycles on outside-tree process residue without sending process signals.
- Focused assistant-engine and Cloudflare tests plus typecheck pass, or any
  unrelated blocker is documented.
- PR is opened and the ReviewGPT PR loop reaches zero accepted findings.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant-codex.ts`
  - focused assistant-engine Codex runtime tests
  - hosted runner Codex CLI 0.142.4 pin and config shape
  - hosted container process isolation tests already tied to the subagent loss
- Out of scope:
  - durable subagent result storage
  - new lifecycle services, queues, or schedulers
  - editing sibling Codex source
  - unrelated Linq webhook or provider-cleanup wake changes

## Decisions

- Treat Codex app-server as the source of truth for thread/subagent lifecycle.
- Do not reject a reused warm process solely because a notification is missing
  a turn id or arrives outside a parent turn.
- Keep the only side-effect gate Murph needs: dynamic tools execute only for
  messages routed into the active parent turn.
- Keep idle compaction because it saves cost, but stop using the compaction
  reader as a stale-output poison path.

## Verification

- Commands to run:
  - focused assistant-engine Codex runtime tests
  - focused Cloudflare container-entrypoint tests
- `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts -t "keeps live steering closed after a pre-lifecycle computer pause request"` passed; the package script ran the full assistant-engine suite.
- `pnpm --dir apps/cloudflare test -- container-entrypoint.test.ts container-entrypoint-abort.test.ts container-image-contract.test.ts` passed; the package script ran the full Cloudflare node workspace.
- `pnpm typecheck` passed after building local workspace package dist artifacts required by the fresh worktree.
- `pnpm --dir packages/hosted-local-harness test` passed after building `packages/assistant-runtime` and `packages/assistant-engine` dist artifacts.
- `pnpm test:diff` passed after the same dist artifact prep; it expanded to the global affected workspace because root/docker/lockfile files changed.
- `git diff --check` passed.

## Current state

- Worktree: `codex/simplify-codex-subagent-routing`
- Implementation complete.
- Main checkout cleanup complete: this lane's dirty files were moved into this branch; unrelated Linq webhook work remains in main.
Completed: 2026-06-30
