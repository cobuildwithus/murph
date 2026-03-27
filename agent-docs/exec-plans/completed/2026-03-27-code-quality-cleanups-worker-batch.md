# Code quality cleanups worker batch

Status: completed
Created: 2026-03-27
Updated: 2026-03-27
Completed: 2026-03-27

## Goal

- Launch six narrow cleanup/refactor lanes in parallel through the local `codex-workers` flow without changing intended product behavior.

## Success criteria

- Active ownership for the parent lane and all six worker lanes is registered in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before worker edits begin.
- One prompt file exists per requested cleanup lane under `agent-docs/exec-plans/active/worker-prompts/2026-03-27-code-quality-cleanups/`.
- The six prompts are launched together through the workspace `codex-workers` helper against the current live worktree.
- Worker prompts call out existing overlap/dirty-file risks so agents preserve unrelated edits instead of resetting or rewriting them.
- Run artifacts are collected under `.codex-runs/` for later integration and review.

## Scope

- In scope:
  - prompt shaping, lane ownership, and launch orchestration for the six requested cleanup tasks
  - setup-wizard step simplification lane
  - hosted webhook receipt state refactor lane
  - assistant provider-config normalization lane
  - Codex event normalization lane
  - canonical write-guard decoding hardening lane
  - Cloudflare declarative router lane
- Out of scope:
  - cross-lane integration beyond worker launch and artifact collection in the orchestration pass
  - speculative product behavior changes outside each prompt's requested cleanup surface

## Constraints

- Follow `AGENTS.md`, the repo completion workflow, and the coordination-ledger hard gate.
- Use the shared current worktree for the batch unless a concrete collision forces a later change.
- Do not revert or discard unrelated edits already present in the worktree.
- Worker prompts must call out overlapping active surfaces:
  - `packages/cli/src/assistant/service.ts` already had unrelated edits.
  - `packages/core/src/operations/write-batch.ts` already had unrelated edits.
  - `apps/web/src/lib/hosted-onboarding/service.ts` overlapped an active hosted-onboarding lane.
- Workers should not create commits in the launch phase.

## Worker lanes

1. `codex-worker-setup-wizard`
   - `packages/cli/src/setup-wizard.ts`, `packages/cli/src/setup-cli.ts`, `packages/cli/test/setup-cli.test.ts`
2. `codex-worker-hosted-webhook-receipts`
   - `apps/web/src/lib/hosted-onboarding/service.ts`, `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
3. `codex-worker-provider-config`
   - `packages/cli/src/chat-provider.ts`, `packages/cli/src/assistant/service.ts`, `packages/cli/src/assistant/failover.ts`, `packages/cli/src/assistant-cli-contracts.ts`, `packages/cli/src/setup-services.ts`, related tests
4. `codex-worker-codex-event-normalization`
   - `packages/cli/src/assistant-codex.ts`, `packages/cli/test/assistant-codex.test.ts`
5. `codex-worker-canonical-write-guard`
   - `packages/cli/src/assistant/canonical-write-guard.ts`, `packages/core/src/operations/write-batch.ts`, `packages/cli/test/assistant-service.test.ts`
6. `codex-worker-cloudflare-router`
   - `apps/cloudflare/src/index.ts`, `apps/cloudflare/test/index.test.ts`

## Decisions

- Used the workspace-local `codex-workers` wrapper because the repo already documents that flow and the user explicitly asked for the codex-workers skill.
- Kept the batch in the shared current worktree. The lanes were largely disjoint, and the known overlaps were narrow enough to handle through prompt ownership plus preserve-adjacent-edits instructions.
- Treated the parent orchestration pass as launch-only. Workers implemented and verified their lanes; the parent lane later handled integration, repo-level verification, and final commit flow.

## Verification

- Launch-time checks:
  - `../workspace-docs/bin/codex-workers --help`
  - targeted `git status --short -- <owned files>` overlap scan before launch
- Batch run:
  - `../workspace-docs/bin/codex-workers --sandbox workspace-write --full-auto agent-docs/exec-plans/active/worker-prompts/2026-03-27-code-quality-cleanups/*.md`
- Worker outcomes:
  - all six workers exited `0` under `.codex-runs/20260327-135139/`

## Progress

- Done:
  - loaded the installed `codex-workers` skill instructions
  - confirmed the workspace-local `../workspace-docs/bin/codex-workers` wrapper exists
  - scanned target-file overlap against the current dirty worktree
  - generated one prompt per requested lane and launched the batch
  - collected all worker summaries and integrated the resulting code changes
- Final state:
  - six worker lanes completed successfully with run artifacts captured under `.codex-runs/20260327-135139/`
