# Live-progress UX polish for the Epic Clinical Records beta

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make the Records status page feel alive while a one-time import runs and make
  the Epic organization search flow clearer, using only the existing
  server-truth refresh path and existing components.

## Success criteria

- While an import is queued, retrieving, or importing, `/records` refreshes its
  server-rendered state on its own at a bounded interval, skips hidden tabs,
  and stops as soon as no import is active; the manual Refresh button stays.
- In-progress connection rows show a quiet spinner beside the status badge, and
  the section notes that the page updates on its own only while that is true.
- On `/records/connect`, previous search results are visibly stale
  (dimmed + `aria-busy`) while a new search is pending, and the organization
  search field receives initial focus.
- Focused Records UI tests, scoped lint, Web typecheck, required completion
  audits, parent final review, PR CI, and the ReviewGPT loop pass with no
  unresolved accepted finding.

## Scope

- In scope: `apps/web/app/(dashboard)/records/records-page-client.tsx`,
  `apps/web/app/(dashboard)/records/connect/records-connect-client.tsx`, and
  `apps/web/test/clinical-records-pages-client.test.tsx`.
- Out of scope: Clinical Records auth, provider directory, retrieval, storage,
  consent, and any server or API behavior.

## Constraints

- No new state owners, dependencies, endpoints, or polling infrastructure;
  reuse `router.refresh()` and existing UI primitives only.
- Preserve the one-time Epic import model and all existing privacy behavior.
- Work only in the existing `codex/epic-beta-live` task worktree and preserve
  unrelated ledger lanes.

## Tasks

1. Implement the auto-refresh effect, live status indicator, stale-results
   treatment, and search autofocus.
2. Extend the focused Records UI suite to prove the new behavior.
3. Capture rendered desktop/mobile evidence from the isolated worktree dev
   stack where reachable states allow.
4. Run frontend-review and coverage-write audits, parent final review, then
   commit, push, and run the PR ReviewGPT round to PASS.
Completed: 2026-07-16
