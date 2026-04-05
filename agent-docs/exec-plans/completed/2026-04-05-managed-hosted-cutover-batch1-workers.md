# Managed-Hosted Cutover Batch 1 Workers

## Goal

Run Batch 1 of the managed-hosted cutover through parallel Codex workers in the current live worktree, then review the resulting diffs and verification before deciding whether to merge or continue.

## Why this plan exists

- The requested work is high-risk and cross-cutting across Cloudflare, hosted web, shared contracts, and Prisma.
- The user explicitly asked for parallel Codex workers and a review/discussion pass before rushing into integration.
- The repo may already have drift relative to the original cutover prompts, so each worker must ground itself in the live tree rather than assume the plan text is exact.

## Constraints

- Treat the cutover prompts as behavioral intent, not overwrite authority.
- Use the shared current worktree; do not create isolated worktrees unless a concrete collision appears.
- Preserve unrelated dirty edits already present in the branch.
- Batch 1 only: prompts 1 to 4.
- No commit before the review/discussion unless the user explicitly changes direction.

## Worker lanes

1. Cloudflare queue confidentiality hard cut.
2. `gateway.message.send` reference-storage full cutover.
3. Managed-hosted key-surface lockdown.
4. Dead onboarding bootstrap-secret deletion.

## Review standard

- Poll patiently; do not rush or cancel healthy long-running workers.
- Read each worker's prompt, log, final message, diff, and touched files.
- Run direct verification against changed surfaces and inspect for trust-boundary regressions.
- Surface blockers, overlaps, or weak assumptions before any merge/commit decision.

## Current state

- Repo docs and routing context loaded.
- `codex-workers` skill loaded from the installed local helper.
- Shared worktree chosen intentionally because the Batch 1 lanes are mostly disjoint.
- Pre-existing dirty edits exist outside this Batch 1 scope and must be preserved.

## Next

1. Write worker prompt files that explicitly instruct live-tree discovery.
2. Launch the helper in shared-worktree full-auto mode.
3. Wait for completion and review lane by lane.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
