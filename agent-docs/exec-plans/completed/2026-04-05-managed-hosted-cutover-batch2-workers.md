# Managed-Hosted Cutover Batch 2 Workers

## Goal

Run Batch 2 of the managed-hosted cutover through parallel Codex workers on top of Batch 1 commit `7b6a5ce2`, then review and integrate the resulting diffs before proceeding to the final integration lane.

## Why this plan exists

- Batch 1 is merged and narrowed the live repo shape to the intended hard-cut surface.
- Batch 2 spans three substantial but mostly separable lanes: hosted email, device-sync escrow, and hosted share/onboarding decrypt-domain cleanup.
- The branch still contains unrelated in-flight edits, so the workers must stay scoped and preserve adjacent work.

## Constraints

- Treat the prompts as behavioral intent, not overwrite authority.
- Use the shared current worktree.
- Preserve unrelated dirty edits already present in the branch.
- Batch 2 only: prompts 5 to 7.
- No fresh architecture rewrite; extend the Batch 1 hard-cut shape already in the tree.

## Worker lanes

1. Hosted email raw-body root-key cutover.
2. Device-sync escrow cutover to Cloudflare.
3. Hosted share plus remaining onboarding decrypt-domain cutover.

## Review standard

- Poll patiently; do not rush or cancel healthy long-running workers.
- Read each worker's prompt, log, final message, diff, and touched files.
- Run focused verification from the integrated live tree.
- Resolve overlaps before deciding whether to merge Batch 2.

## Current state

- Batch 1 merged as commit `7b6a5ce2`.
- The active unrelated assistant/document-preservation lane remains in the worktree and must be preserved.
- Batch 2 workers should build on the live post-Batch-1 tree, not on the original planning text alone.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
