---
title: 'Frontend-only worktree dev command starts the full hosted stack'
severity: 'minor'
---

## Friction

`agent-docs/operations/hosted-local-worktree-dev.md` recommends
`cd apps/web && NEXT_DIST_DIR_MODE=smoke NEXT_DIST_DIR_SUFFIX=<slug> pnpm dev -- --hostname ...`
for frontend-only proof. The current `apps/web` `dev` script invokes
`vercel env run -- pnpm dev:local-env`, and `dev:local-env` starts the hosted-local
runner instead of a standalone Next server. This forces frontend-only reviewers
to discover and invoke `next dev` directly to avoid unrelated provider/env startup.

## Suggested improvement

Add a documented app-local script for isolated standalone Next rendering, or
update the frontend-only example to the canonical current command while
preserving the worktree-specific port and dist suffix.
