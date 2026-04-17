## Goal

Land the supplied hosted-wake substrate patch as a scoped hosted cutover step that adds the web-owned wake queue/cursor fence, signed internal wake APIs, Cloudflare client helpers, and flagged shadow dual-write producers without changing live behavior while the flag is off.

## Scope

- `apps/web/prisma/**` hosted wake substrate schema and migration
- `apps/web/app/api/internal/hosted-wake/**` signed internal unseen/commit APIs
- `apps/web/src/lib/hosted-wake/**` payload, store, dispatch, and flag logic
- `apps/web/src/lib/hosted-onboarding/{member-activation,member-channel-sync}.ts`
- `apps/web/README.md`
- `apps/cloudflare/src/web-control-plane.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `packages/hosted-execution/test/hosted-wake-parsers.test.ts`

## Constraints

- Preserve unrelated dirty worktree edits and do not widen beyond the supplied patch unless repo drift forces a minimal fix.
- Keep canonical hosted queue/cursor truth in `apps/web`; do not move control facts into Cloudflare or assistant runtime.
- Keep external behavior unchanged when the hosted-wake shadow-write flag is off.
- Treat the change as high-sensitivity because it touches signed internal APIs, queue/cursor persistence, and hosted execution control surfaces.
- Avoid exposing secrets or personal identifiers in logs, code, commits, or handoff.

## Verification

- Required high-risk verification:
  - `pnpm typecheck`
  - `pnpm verify:acceptance` unless a truthful diff-aware lane clearly covers the full touched owner slice
- Capture any direct local proof feasible for the new wake parser/store/API seams
- Run required completion audits before handoff
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
