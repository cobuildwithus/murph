# TODOs

## Dashboard Data Phase (rocketman handoff)

### Auth gate for dashboard layout
**Priority:** High (do first before any data fetching)
**What:** Add Privy auth check to `app/(dashboard)/layout.tsx`. Redirect unauthenticated users to sign-in.
**Why:** Dashboard pages are logged-in surfaces. Without auth, anyone can access experiment data once real data replaces hardcoded mocks. Pattern exists in `apps/web/app/settings/page.tsx` (line 15+).
**Context:** Codex flagged as P1 during eng review (2026-04-14). User deferred auth to data phase. Must land before any fetch calls go in.
**Depends on:** Nothing.

### Loading and error states for dashboard routes
**Priority:** Medium (after auth gate + data fetching)
**What:** Add `loading.tsx` and `error.tsx` to `app/(dashboard)/overview/`, `app/(dashboard)/experiments/`, and `app/(dashboard)/experiments/[experimentId]/`.
**Why:** Pages with async data need loading skeletons and error boundaries. `Skeleton` component already exists in the design system.
**Context:** Standard Next.js pattern. Deferred during hardcoded data phase (2026-04-14 eng review).
**Depends on:** Auth gate, data fetching implementation.
