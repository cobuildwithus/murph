# AssistantD Local Runtime Extraction

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

Integrate the supplied AssistantD P0 local-runtime extraction into the current repo so the local assistant runtime gains a loopback daemon boundary, a thinner service coordinator, explicit runtime-state and conversation-policy seams, and append-only transcript distillation without regressing the existing CLI and hosted boundaries.

## Scope

- Land the supplied runtime extraction across:
  - new `packages/assistantd/**`
  - `packages/cli/src/{assistant-runtime.ts,assistant-daemon-client.ts,assistant-cli-contracts.ts}`
  - `packages/cli/src/assistant/{service.ts,service-contracts.ts,conversation-policy.ts,runtime-state-service.ts,session-resolution.ts,provider-binding.ts,turn-plan.ts,delivery-service.ts,turn-finalizer.ts,reply-sanitizer.ts,transcript-distillation.ts}`
  - targeted CLI/runtime-state tests
  - workspace/release wiring
- Reconcile the landed patch with the current tree rather than assuming the supplied snapshot is the final truth.
- Add the minimum architecture and verification doc updates required by repo policy for a new local runtime entrypoint.

## Constraints

- Preserve unrelated dirty work already present in the shared worktree.
- Preserve the existing canonical vault write boundary inside core/CLI services.
- Keep the staged in-process fallback for progress-hooked turns and local snapshots.
- Treat transcript distillations as runtime continuity only, never canonical memory or vault truth.

## Risks

1. The patch overlaps the active assistant integration lane and nearby assistant runtime refactor areas.
   Mitigation: apply only after reading live state, then review overlapping files for unintended regressions and preserve adjacent edits.
2. A new daemon package changes runtime and verification expectations.
   Mitigation: update package wiring plus architecture and verification docs in the same change.
3. Repo-wide verification may still be red because of unrelated in-flight work.
   Mitigation: run the required commands, separate unrelated failures carefully, and document causal boundaries if needed.

## Verification Plan

- Run targeted assistantd/CLI tests while integrating.
- Run at least one direct scenario check proving the daemon/client routing boundary.
- Run required repo commands unless blocked by unrelated pre-existing failures:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Run the mandatory completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `task-finish-review`

## Working Notes

- `git apply --check /Users/willhay/Downloads/0000-murph-assistantd-p0-unified.patch` succeeds against the current tree, so the supplied patch is a viable integration base.
- The migration guide explicitly stages daemon routing so progress-hooked turns remain in-process for now; that compatibility must stay intact.
- Repo policy requires documenting new runtime entrypoints and verification expectations alongside the code change, even if the supplied patch did not include every doc update.
- Mandatory `simplify` and `task-finish-review` audit passes both ran via spawned subagents; the final pass surfaced four real follow-ups that were fixed in-scope:
  - loopback-only assistantd client base URL enforcement
  - restored outbound reply sanitization parity for local file/source scaffolding
  - redacted assistantd startup and health metadata so raw vault paths are not emitted
  - transcript distillation continuity wording clarified as Murph-generated non-canonical continuity
- Final focused verification after those fixes:
  - `pnpm --dir packages/assistantd test`
  - `pnpm exec vitest run packages/assistantd/test/http.test.ts packages/cli/test/assistant-daemon-client.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-service.test.ts --no-coverage --maxWorkers 1`
- Required repo commands still fail outside this lane:
  - `pnpm typecheck` in `packages/query/test/health-registry-definitions.test.ts`
  - `pnpm test` and `pnpm test:coverage` in `packages/web/test/overview.test.ts`
Completed: 2026-03-29
