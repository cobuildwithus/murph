# PR 932 latest-main refresh

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Reconcile the final PR #932 head with newly advanced `origin/main` while
  preserving both current line-capacity behavior and the certified group-join
  outreach limits.

## Scope

- `apps/web/src/lib/hosted-onboarding/linq-line-store.ts`
- directly affected tests and current-main merge-generated updates
- exact-head verification, CI, PR metadata, and ReviewGPT

## Constraints

- Resolve the one observed production conflict from both owners; do not choose
  either side wholesale.
- Add no capacity owner, queue, retry lifecycle, or compatibility path.
- Leave PR #932 open and unmerged.

## Verification

- Merged `origin/main` at
  `cde5211b77bafab267c5c4b392d26ca701d1b805`; merge commit
  `bda5434f13e278619636cea733c3f18ed9bb567c`.
- Resolved `linq-line-store.ts` by preserving the current-main
  healthy-or-unknown predicate for inbound route authority and the PR's
  explicitly-healthy-only query for proactive first outreach. These are
  intentionally different admission rules, not duplicate ownership.
- Directly affected Vitest suite: 3 files passed, 113 tests passed.
- `pnpm test:diff apps/web`: 558 files passed, 16 skipped; 7,291 tests passed,
  220 skipped; TypeScript, lint (zero errors), dev smoke, and production build
  passed.
- `pnpm verify:acceptance`: passed locally, including all package coverage,
  Web verification, Cloudflare Node tests (109 files / 2,028 tests), and
  Cloudflare Workers tests (2 files / 2 tests).
- Final privacy, diff, conflict-marker, current-`main` merge simulation, CI,
  and exact-head ReviewGPT evidence are recorded in the PR handoff rather than
  this archived implementation plan.
Completed: 2026-07-28
