# Bound settings page database query fan-out

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Stop a single `/settings` render from fanning out ~20-40 concurrent Prisma
  queries. The page ran nine data helpers in one `Promise.all`, and several
  of those helpers fan out parallel queries internally (family owner
  snapshot, account settings snapshot, usage status), so one render could
  exhaust the 15-client web connection pool by itself.

## Success criteria

- The two Privy network reads still overlap the database work; the seven
  database-backed helpers run sequentially, so peak render concurrency drops
  to the largest single helper (~5 queries) instead of the sum.
- Rendered page data, fallbacks for unauthenticated members, and error
  swallowing (`.catch`) behavior are unchanged.
- Scoped verification passes.

## Scope

- In scope: `apps/web/app/(dashboard)/settings/page.tsx`.
- Out of scope: the helpers' internal small fixed fan-outs (bounded ≤5), the
  home page's bounded 5-way read, sidebar-status API (already sequential).
Completed: 2026-07-16
