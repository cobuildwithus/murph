# Local Hosted Dev Canonicalization

## Goal

Align the repo-root hosted local-dev lane with the cleanest documented Cloudflare and Vercel local-development contracts.

## Scope

- Re-read the local dev docs and repo docs for Cloudflare Workers/Containers and Vercel CLI env handling.
- Remove implementation details that fight those contracts.
- Keep the same one-command `pnpm dev` experience.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not weaken hosted auth or secret handling.
- Prefer documented local-dev inputs over repo-local hacks.

## Verification

- Truthful diff-aware verification for touched owners.
- Direct startup proof for the updated root `pnpm dev` flow.

## Notes

- The current launcher works, but it may still be doing more local state mutation than the platform docs require.
Status: completed
Updated: 2026-04-13

## Outcome

- Removed the temporary `apps/cloudflare/.dev.vars` rewrite path from the root launcher.
- The root launcher now follows Wrangler's documented local-secret contract more closely:
  - required worker secrets come from the child `process.env`
  - localhost worker/web non-secret overrides go through Wrangler CLI `--var`
  - an operator-owned `apps/cloudflare/.dev.vars` is read when present but no longer mutated
- The root launcher now accepts either project-local `vercel link` metadata or repo-root `vercel link --repo` metadata before startup.
- README now carries a repeatable alternate-port `pnpm dev` sanity-check recipe instead of leaving that launcher proof only in this plan note.
- Direct runtime proof with no `apps/cloudflare/.dev.vars` present:
  - `NEXT_DIST_DIR_MODE=smoke MURPH_DEV_WEB_PORT=3013 MURPH_DEV_WORKER_PORT=8793 pnpm dev`
  - Wrangler reported `Using secrets defined in process.env`
  - the launcher reached `Local hosted dev is ready.` with healthy web and worker endpoints
Completed: 2026-04-13
