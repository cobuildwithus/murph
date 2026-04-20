## Title

Land the supplied sauna research expansion patch for `packages/health-commons`.

## Goal

Apply the returned ChatGPT patch where it still fits the current repo so Murph's health-commons package gains the expanded sauna research content, the local artifact-hash helper, and the documented Cloudflare R2 article-staging flow without touching unrelated dirty worktree areas.

## Scope

- `.gitignore`
- `packages/health-commons/**`

## Constraints

- Preserve all unrelated dirty-tree edits, especially the active hosted-runner and hosted-runtime lanes already registered in the coordination ledger.
- Treat the supplied patch as bounded intent, not overwrite authority; adapt only where the current worktree has drift.
- Keep the change limited to the returned sauna research expansion patch and direct generated-artifact fallout.

## Verification

- planned: `pnpm typecheck`
- planned: `pnpm test:diff .gitignore packages/health-commons`
- planned: `pnpm test:smoke`
- planned: `git diff --check`

## Notes

- The returned patch includes content pages, artifact manifests, generated health-commons artifacts, and a new `artifacts:hash` helper alongside README/docs updates.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
