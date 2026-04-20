## Title

Stop treating zero-event hosted runtime timers as `assistant.cron.tick`.

## Goal

Remove the semantically meaningful synthetic `assistant.cron.tick` wake from the hosted run path when `triggerKind` is `runtime_timer` and the run has no external events. Runtime timers should stay internal to the runner/runtime contract and not masquerade as persisted ingress wakes.

## Scope

- `agent-docs/references/hosted-run-protocol.md`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `packages/assistant-runtime/src/hosted-runtime/{context,events,execution,maintenance,models,summary,utils}.ts`
- focused `packages/assistant-runtime/test/**`
- `apps/cloudflare/src/user-runner.ts`
- focused `apps/cloudflare/test/**` only where the runtime-timer contract changes require it
- verification, audit, and commit artifacts required by repo policy for this slice

## Constraints

- Keep external/manual/admin `assistant.cron.tick` semantics intact where they are already part of persisted/web-owned wake contracts.
- Do not introduce a new persisted/web-owned runtime timer wake kind.
- Preserve overlapping dirty-tree hosted-run hard-cut work and adjacent contract edits already in flight.
- Prefer an internal-only runner/runtime representation or direct run-drain handling over another public compatibility shim.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff agent-docs/references/hosted-run-protocol.md packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/src/hosted-runtime/summary.ts packages/assistant-runtime/src/hosted-runtime/utils.ts packages/assistant-runtime/test apps/cloudflare/src/user-runner.ts apps/cloudflare/test`
- planned: `git diff --check`

## Notes

- The target end state is `triggerKind = runtime_timer` plus `events = []` for zero-event due work, with runtime follow-up lanes running because of the run context rather than because a fake ingress wake was invented.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
