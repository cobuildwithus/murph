# Six refactor worker batch

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Validate the user's six new refactor prompts against the live tree.
- Launch an overlap-aware `codex-workers` batch in the current shared worktree with one worker per validated prompt.

## Success criteria

- Active ownership for the parent orchestration lane and all six worker lanes is registered in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before launch.
- One prompt file exists per worker under `agent-docs/exec-plans/active/worker-prompts/2026-03-27-six-refactor-batch/`.
- The batch is launched through `../workspace-docs/bin/codex-workers` against the current live worktree.
- Each worker prompt reflects the current file/symbol reality and calls out concrete overlap notes for dirty or active surfaces.
- Run artifacts land under `.codex-runs/` for later integration.

## Validation summary

- Prompt 1 is still valid. `apps/web/src/lib/hosted-onboarding/webhook-service.ts` still contains both webhook entrypoints plus the receipt codec and queue/drain helpers in one file.
- Prompt 2 is still valid. `packages/query/src/health/canonical-collector.ts` still contains separate strict/tolerant and sync/async pipelines plus cast-heavy `REGISTRY_COLLECTORS`.
- Prompt 3 is still valid. `packages/core/src/history/api.ts` still uses `HistoryFieldDefinition<unknown>`, `HISTORY_KIND_DEFINITIONS`, and cast-heavy subtype normalization.
- Prompt 4 is still valid. `packages/core/src/mutations.ts` still carries loose device/sample input types deep into `prepareDeviceBatchPlan`.
- Prompt 5 is still valid. `packages/cli/src/assistant/canonical-write-guard.ts` still duplicates recoverable stored-write parsing and protected-path policy that `@healthybob/core` does not yet share.
- Prompt 6 is still valid. `packages/assistant-runtime/src/hosted-runtime.ts` still mixes restore/env/bootstrap/dispatch/commit/finalize concerns in `runHostedAssistantRuntimeJobInProcess`, and the primary caller remains `apps/cloudflare/src/node-runner.ts`.

## Scope

- In scope:
  - prompt validation against current code
  - shared-worktree lane design for the six refactors
  - writing worker prompt files
  - launching the worker batch and collecting startup status
- Out of scope:
  - integrating worker diffs in this parent pass
  - repo-wide verification or commits for worker-produced code
  - merging the six refactors into a smaller batch unless validation finds concrete same-file collisions

## Constraints

- Follow `AGENTS.md`, the installed `codex-workers` skill, and the coordination-ledger hard gate.
- Keep the batch in the current shared worktree unless a concrete collision forces isolation; this batch remains shared.
- Do not revert or discard unrelated dirty work already present in the tree.
- Preserve the user's behavior-preserving guardrails in each prompt.
- Flag concrete overlap notes in the worker prompts:
  - `packages/assistant-runtime/src/hosted-runtime.ts` and `apps/cloudflare/src/node-runner.ts` are already dirty.
  - `packages/cli/src/assistant/canonical-write-guard.ts` overlaps the active assistant guard lane.
  - `packages/core/src/operations/write-batch.ts` was recently touched by an inbox/core mutation lane.
  - `apps/web/src/lib/hosted-onboarding/webhook-service.ts` sits on an active hosted-onboarding surface even though it is currently clean.

## Worker lanes

1. `codex-worker-webhook-receipt-engine`
2. `codex-worker-canonical-collector`
3. `codex-worker-history-normalizers`
4. `codex-worker-device-batch-normalization`
5. `codex-worker-canonical-write-guard-dedupe`
6. `codex-worker-hosted-runtime-lifecycle`

## Tasks

1. Register the parent lane and six worker lanes in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
2. Write one prompt file per worker with explicit scope, guardrails, overlap notes, and verification/reporting expectations.
3. Launch the batch through `../workspace-docs/bin/codex-workers --raw-prompts --sandbox workspace-write --full-auto -m gpt-5.4`.
4. Capture the `.codex-runs/...` directory and check for startup failures.
5. Hand back the run directory plus a concise validation-and-launch summary.

## Decisions

- Keep one worker per prompt. The six requested lanes do not have enough same-file overlap with each other to justify merging them.
- Use the local wrapper `../workspace-docs/bin/codex-workers` because the installed skill explicitly prefers a documented wrapper when available.
- Use `--raw-prompts` because the prompt files already contain the worker-specific bootstrap and ownership instructions.
- Treat this parent lane as orchestration only. Workers may edit code and run narrow verification, but this lane only validates prompts, writes prompt files, and launches the batch.

## Verification

- Launch-time checks:
  - `../workspace-docs/bin/codex-workers --help`
  - targeted `rg` symbol scans for all six prompts
  - `git status --short --` on the directly touched implementation files to identify dirty overlap
- Worker expectations:
  - run the narrowest truthful tests for the owned surface
  - report exact commands and outcomes
  - report blockers or unverified gaps explicitly

## Progress

- Done:
  - loaded the installed `codex-workers` skill instructions
  - read `AGENTS.md`, `agent-docs/index.md`, `agent-docs/operations/completion-workflow.md`, and the active coordination ledger
  - validated all six prompts against the live tree with targeted symbol scans
  - checked direct dirty overlap on the implementation files
  - registered the parent lane and six worker lanes in the coordination ledger
  - wrote the six worker prompt files
  - launched `../workspace-docs/bin/codex-workers --raw-prompts --sandbox workspace-write --full-auto -m gpt-5.4 agent-docs/exec-plans/active/worker-prompts/2026-03-27-six-refactor-batch/*.md`
  - confirmed the run directory `.codex-runs/20260327-195602`
  - collected all six worker exit codes and final summaries
  - cleared the temporary parent/worker ledger rows after the batch finished
- Now:
  - parent orchestration lane complete
- Next:
  - inspect and integrate the worker-produced diffs in a follow-up pass if desired
