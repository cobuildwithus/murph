# Hosted Cutover Worker Pack

## Purpose

This directory is a ready-to-run `codex-workers` prompt pack for the hosted control-plane cutover.
It is intentionally setup-only: no workers have been launched yet from this pack.

## Workspace Model

- Run the workers in this sibling repo clone on clean `main`.
- Do not run the batches in the live dirty checkout.
- Use one shared live worktree in this sibling repo clone, as the `codex-workers` skill prefers by default.
- Use `--raw-prompts` so the prompt files below stay authoritative while still receiving the repo `AGENTS.md` bootstrap automatically from the helper.

## Parent-Agent Responsibilities

- The parent agent owns orchestration, merge resolution, scoped verification between batches, final repo verification, completion audits, commit, push, and any eventual merge-back into the live repo.
- Batch workers should not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or this prompt-pack directory.
- Batch workers should not create commits, push, invoke commit helpers, or spawn nested workers/subagents.

## Preconditions Before Launch

1. `cd` into the sibling repo clone.
2. Confirm `git status --short --branch` shows clean `main`.
3. Open a dedicated high-risk execution lane for the actual implementation pass.
4. Add batch-specific coordination-ledger rows before each batch starts.
5. Launch only Batch 1 first.

## Batch 1 Command

Run from the sibling repo root:

```bash
"$HOME/.codex-2/skills/codex-workers/scripts/codex-workers" \
  --raw-prompts \
  --sandbox workspace-write \
  --full-auto \
  -j 5 \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch1-agent1-shared-hosted-contracts.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch1-agent2-web-schema-owner-cutover.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch1-agent3-web-execution-control-plane.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch1-agent4-cloudflare-control-surface.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch1-agent5-cloudflare-runtime-kernel.md
```

After Batch 1 returns:

- review each worker diff locally
- merge the surviving changes into one coherent Batch 1 tree
- run truthful focused verification while debugging/integrating
- do not run completion audits yet
- do not launch Batch 2 until the merged Batch 1 tree is stable

## Batch 2 Command

Run only after Batch 1 is merged locally:

```bash
"$HOME/.codex-2/skills/codex-workers/scripts/codex-workers" \
  --raw-prompts \
  --sandbox workspace-write \
  --full-auto \
  -j 5 \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch2-agent6-device-sync-authority.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch2-agent7-share-ownership.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch2-agent8-onboarding-billing-webhooks.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch2-agent9-usage-business-outcomes.md \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/batch2-agent10-cloudflare-deploy-config.md
```

After Batch 2 returns:

- review each worker diff locally
- merge the surviving changes into one coherent Batch 2 tree on top of Batch 1
- run truthful focused verification while debugging/integrating
- keep completion audits deferred to the final merged pass

## Final Integration Command

Run only after the merged Batch 2 tree is stable:

```bash
"$HOME/.codex-2/skills/codex-workers/scripts/codex-workers" \
  --raw-prompts \
  --sandbox workspace-write \
  --full-auto \
  -j 1 \
  agent-docs/exec-plans/active/2026-04-16-hosted-cutover-worker-pack/final-agent11-integration-proof.md
```

## Verification And Audit Intent

- Individual worker lanes should run only focused, truthful verification for their owned paths when that helps them finish a coherent patch.
- The parent agent owns merged-scope verification between batches.
- The final merged pass is high-risk/cross-cutting work. The parent agent should run the repo-required completion flow after the merged tree is stable.
- `task-finish-review` is mandatory for the final merged landing.
- `frontend-review` is expected on the final merged landing because the scope includes `apps/web/app/share/**`.
- `simplify` is expected if the final merged diff meets the repo threshold.
- `coverage-write` is only required if the final completion lane relies on owner-level or truthful diff coverage instead of the full acceptance lane.

## Final Merge-Back Reminder

- Treat the later merge back into the live repo as a separate deliberate step.
- Do not blindly `git pull` into the live dirty checkout.
- Push the finished sibling-repo landing first, then merge that known commit into the live repo with explicit review of overlapping local edits.
