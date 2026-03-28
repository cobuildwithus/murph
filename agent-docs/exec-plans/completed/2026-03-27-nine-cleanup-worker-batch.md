# Nine cleanup worker batch

Status: completed
Created: 2026-03-27
Updated: 2026-03-28
Completed: 2026-03-28

## Goal

- Launch an overlap-aware `codex-workers` batch for the user's nine cleanup prompts in the current live worktree.
- Merge the two assistant-normalization prompts into one worker lane because both need `packages/cli/src/assistant/store/paths.ts`.

## Success criteria

- Active ownership for the parent orchestration lane and each worker lane is registered in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before launch.
- One worker prompt exists per final lane under `agent-docs/exec-plans/active/worker-prompts/2026-03-27-nine-cleanup-batch/`.
- The batch is launched through `../workspace-docs/bin/codex-workers` against the current live worktree.
- Each prompt calls out overlapping dirty files or active lanes so workers preserve unrelated edits.
- Run artifacts land under `.codex-runs/` for collection and later integration.

## Scope

- In scope:
  - prompt shaping for the requested cleanup tasks
  - overlap-aware lane design for the shared current worktree
  - worker launch orchestration and startup-status collection
- Out of scope:
  - integrating worker diffs in this parent pass
  - repo-wide verification or commits for worker-produced code
  - broad reprioritization of existing active lanes outside the requested cleanup batch

## Constraints

- Follow `AGENTS.md`, the installed `codex-workers` skill, and the coordination-ledger hard gate.
- Default to the shared current worktree unless a concrete collision forces isolation; this batch stays shared.
- Do not revert or discard unrelated dirty work already present in the tree.
- Worker prompts must call out overlapping active or dirty surfaces:
  - `packages/cli/src/{chat-provider.ts,assistant/failover.ts,assistant/store/paths.ts,setup-services.ts}` are already dirty.
  - `packages/importers/src/device-providers/{garmin.ts,whoop.ts}` are already dirty.
  - `apps/web/app/api/device-sync/agent/session/` already has untracked in-flight route work.
  - `packages/cli/src/device-sync-client.ts` and `packages/web/src/lib/device-sync.ts` overlap the active local device-sync control-plane lane.
  - `apps/cloudflare/src/index.ts` and `apps/cloudflare/test/index.test.ts` are already dirty from a separate router lane, so the encrypted-R2 worker must stay off that surface.
- Workers should not create commits in this launch phase.

## Worker lanes

1. `codex-worker-assistant-session-normalization`
   - merged from user prompts 1 and 2
   - owns assistant provider-option normalization plus conversation/session locator normalization
2. `codex-worker-scheduled-updates-deferral`
   - user prompt 3
3. `codex-worker-importer-vault-alias`
   - user prompt 4
4. `codex-worker-device-batch-types`
   - user prompt 5
5. `codex-worker-device-sync-control-client`
   - user prompt 6
6. `codex-worker-hosted-device-sync-routes`
   - user prompt 7
7. `codex-worker-share-pack-payloads`
   - user prompt 8
8. `codex-worker-cloudflare-encrypted-r2`
   - user prompt 9

## Tasks

1. Register the parent lane and worker lanes in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
2. Write one prompt file per final worker lane with explicit scope, overlap notes, and verification/reporting expectations.
3. Launch the batch through `../workspace-docs/bin/codex-workers --raw-prompts --sandbox workspace-write --full-auto`.
4. Capture the `.codex-runs/...` directory and check for startup failures or obvious prompt/worktree conflicts.
5. Hand back the run directory plus a concise startup summary.

## Decisions

- Keep the batch in the shared current worktree. The requested tasks are mostly disjoint, and the concrete same-file overlap is limited enough to solve by merging prompts 1 and 2 into one lane.
- Use the workspace-local `../workspace-docs/bin/codex-workers` wrapper because the repo already has that documented path and it satisfies the `codex-workers` skill.
- Use `--raw-prompts` because the prompt files already include explicit worker instructions and ownership boundaries.
- Treat this parent pass as orchestration only. Workers may edit code and run narrow verification, but the parent lane's job is prompting, launch, and status collection.

## Verification

- Launch-time checks:
  - `../workspace-docs/bin/codex-workers --help`
  - targeted overlap scan against the current dirty worktree
- Worker expectations:
  - run the narrowest truthful verification for the owned surface
  - report exact commands and results
  - report any direct scenario proof or remaining gap

## Progress

- Done:
  - loaded the installed `codex-workers` skill instructions
  - read the repo routing, completion-workflow, verification, and coordination-ledger docs
  - mapped the requested prompts against active ledger rows and current dirty files
  - merged prompts 1 and 2 into one lane because both need `packages/cli/src/assistant/store/paths.ts`
  - registered the new parent lane and worker lanes in the coordination ledger
  - wrote the eight worker prompt files for the batch
  - launched `../workspace-docs/bin/codex-workers --raw-prompts --sandbox workspace-write --full-auto -m gpt-5.4 agent-docs/exec-plans/active/worker-prompts/2026-03-27-nine-cleanup-batch/*.md`
  - confirmed the live run directory is `.codex-runs/20260327-143744`
- Done:
  - collected the worker prompt artifacts and integrated the resulting cleanup lanes back into the shared tree
  - preserved the worker-prompt bundle as completed execution context for the batch
