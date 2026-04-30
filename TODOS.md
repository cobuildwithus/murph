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

### Health Commons biomarker model field gaps (rocketman-21 follow-up)
**Priority:** Medium (replace hardcoded frontend lookups)
**What:** Add three fields to Health Commons biomarker model so the new biomarker detail page can drop temporary frontend hardcodes:
1. `BiomarkerProtocolRankingModel.signal: { range: string; window: string } | null` — replaces `src/lib/biomarkers/biomarker-experiment-signals.ts` lookup table
2. `BiomarkerPageModel.about: { whyItMatters: string; howItsMeasured: string; whatMovesIt: string } | null` — replaces `src/lib/biomarkers/biomarker-about.ts` per-biomarker prose
3. `BiomarkerProtocolRankingModel.image: string` — eliminates `resolveHealthCommonsExperimentShell` lookup-per-row in card renderer (currently works but couples biomarker UI to experiment resolver)
**Why:** Biomarker page redesign (2026-04-29) shipped with three frontend lookup tables that duplicate or work around missing model fields. They are commented `TEMPORARY` and should be removed after backend ships these fields.
**Context:** /office-hours + /plan-eng-review on 2026-04-29 surfaced these as gaps. Frontend hardcodes accepted as MVP because rocketman-21 owns the data model and is iterating. PR for the redesign tags @rocketman-21 with the same list.
**Depends on:** Nothing on frontend side. Rocketman ships → frontend deletes the lookup tables and replaces with model field reads.
