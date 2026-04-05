# Managed-Hosted Cutover Final Integration

## Goal

Finish Prompt 8 for the managed-hosted cutover by removing remaining legacy compatibility surface, renaming the platform-wide key to its envelope/bootstrap role, cleaning obsolete docs/routes/schema/env references, and proving the final simplified architecture.

## Why this plan exists

- Batch 1 and Batch 2 are merged, but the repo still needs the final integration/cleanup lane.
- This pass is cross-cutting across Cloudflare, web, shared contracts, docs, and Prisma surface.
- The branch already contains unrelated dirty edits that must be preserved while this cleanup lands.

## Constraints

- Preserve unrelated dirty worktree edits.
- Treat Cloudflare as the sole decrypt domain for user-scoped secret material.
- Keep `HOSTED_CONTACT_PRIVACY_KEY` as the only intentional web-side privacy exception.
- Remove compatibility readers, writers, routes, env aliases, and stale docs rather than adding new abstractions.
- Run required verification and required audit review before commit.

## Workstreams

1. Find and remove remaining platform-key / bundle-key naming and legacy env aliases.
2. Remove dead managed-hosted envelope/recipient surface and stale compatibility helpers.
3. Update architecture/docs/env/schema truth to the final cutover design.
4. Run focused plus required verification, then final audit review and any follow-up fixes.

## Current state

- Batch 2 is merged as `e9f0f2ef`.
- Unrelated assistant/preset edits remain dirty in the worktree and are out of scope.
- No active execution plan currently exists for the final integration lane.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
