# 2026-04-10 Assistant Event-Driven Scheduler Cutover

## Goal

- Land the returned assistant scheduler patch locally, but only the deltas that still apply safely on top of the current repo state.
- Replace the generic assistant scan-interval fallback with explicit event/deadline wake propagation across local automation, parser wake signals, and hosted maintenance scheduling.
- Preserve unrelated in-flight work and finish with repo-required verification, audit, and commit flow.

## Scope

- Returned patch artifact from the external thread
- `packages/assistant-engine/**`
- `packages/assistant-cli/**`
- `packages/assistant-runtime/**`
- `packages/inbox-services/**`
- `packages/inboxd/**`
- `packages/assistantd/**`
- `packages/cli/**`
- `apps/cloudflare/**`
- Durable docs only if the landed delta changes repo truth

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Preserve unrelated dirty-tree edits, including the pre-existing edit in `packages/cli/test/assistant-service.test.ts`.
- Keep the scheduler cutover coherent across local and hosted paths; do not land partial wake/deadline semantics that leave one side relying on removed fallback knobs.
- Run the verification lane required for the touched owners and capture direct proof for the new wake/deadline behavior.

## Plan

1. Inspect the returned patch against the live repo and identify stale, conflicting, or already-landed hunks.
2. Port the still-applicable assistant, inbox, hosted-runtime, and Cloudflare scheduler changes onto the current tree.
3. Update any durable docs that need to reflect the removed fallback alarm / scan-interval model.
4. Run the required verification plus direct proof for the new wake/deadline scheduling behavior.
5. Complete the required audit passes, close the plan, and create a scoped commit.

## Progress

- Done: read the always-read docs, reliability guidance, verification/completion workflow, and the returned patch.
- Done: confirmed the worktree already has an unrelated pre-existing edit in `packages/cli/test/assistant-service.test.ts`.
- Done: ported the returned scheduler cutover across assistant-engine, assistant-cli, inbox runtime/daemon, assistant-runtime, assistantd, CLI schema/contracts, and Cloudflare runner paths, including manual resolution for the hosted maintenance file.
- Done: aligned Cloudflare/node-runner expectations to the explicit `nextWakeAt` and no-fallback-alarm model.
- Done: resolved final-review findings by preserving startup-recovery retry deadlines in the continuous run loop and adding boundary coverage for continuous `startDaemon: false` rejection through assistantd and the daemon client.
- Now: close the active plan and create the scoped commit.
- Next: none.

## Verification

- Passed:
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-engine packages/assistant-cli packages/assistantd packages/assistant-runtime packages/inbox-services packages/inboxd packages/cli apps/cloudflare`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-automation-runtime.test.ts`
  - `pnpm exec vitest run packages/assistantd/test/http.test.ts`
  - `pnpm exec vitest run packages/cli/test/assistant-daemon-client.test.ts`
- Direct proof captured:
  - continuous local automation waits on explicit `nextWakeAt`, including startup-recovery retry deadlines
  - `parser.jobs.drained` wakes the local automation loop immediately
  - hosted runner alarms clear when no next wake remains and do not reuse stale wake values
- Audit passes:
  - required `coverage-write` pass landed focused proof in `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
  - required `task-finish-review` pass found and drove the startup-recovery wake fix plus continuous `startDaemon: false` boundary coverage
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
