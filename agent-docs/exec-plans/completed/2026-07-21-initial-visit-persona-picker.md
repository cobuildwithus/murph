# Replace initial-visit onboarding with persona picker

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Make `/home?initialVisit=true` open the approved production Murph persona
  picker directly, replacing the legacy contact-card, persona, and welcome
  dialog sequence on that one-shot first-visit path.

## Success criteria

- Initial visits render the existing four-step production persona picker.
- The `initialVisit` query marker is removed without dropping other query
  parameters or the URL hash.
- Saving continues through the existing atomic assistant-style preference API;
  skip or dismissal closes without writing.
- The legacy home-only contact-card and welcome orchestration is deleted while
  signup-success and Settings contact surfaces remain unchanged.
- Focused tests, Web typecheck, lint, desktop/mobile browser proof, and required
  specialist reviews pass.

## Scope

- In scope: the `/home` initial-visit projection, its focused tests, and current
  product documentation.
- Out of scope: persona-picker visual redesign, preference persistence changes,
  signup-success contact-card behavior, and assistant prompt semantics.

## Constraints

- Technical constraints: preserve the existing picker as the single UI and
  persistence owner; keep the Next.js server/client boundary explicit; do not
  add a client search-parameter dependency or a new state owner.
- Product/process constraints: work on `main` per the user's ongoing direction,
  preserve unrelated dirty-tree work, and keep the session-owned dev server
  running for review.

## Risks and mitigations

1. Risk: the marker could persist and reopen onboarding on every navigation.
   Mitigation: consume only `initialVisit` with `history.replaceState` while
   preserving other URL state, with a focused client test and browser proof.
2. Risk: deleting the home orchestration could accidentally remove the shared
   contact-card product.
   Mitigation: delete only the home-only coordinator and leave the shared
   signup-success and Settings surfaces untouched.

## Tasks

1. Trace the current initial-visit route and production picker ownership.
2. Replace the home-only coordinator with a minimal picker opener.
3. Delete obsolete home-only UI and tests, then add focused route/client proof.
4. Update current-state docs, run verification and specialist reviews, and
   commit only the scoped change.

## Decisions

- Use the existing `MurphPersonaPicker` without duplicating its selection or
  save state.
- Consume the marker on mount, matching the previous one-shot route behavior.
- Remove the contact-card and trailing welcome dialog only from this home route.

## Verification

- Passed: focused Vitest (22 tests), Web `typecheck:prepared`, scoped ESLint,
  `pnpm docs:drift`, canonical `pnpm test:diff` (6,016 executed Web tests,
  full lint, dev smoke, and production build), and `git diff --check`.
- Passed: fresh desktop and mobile browser proof. Both viewports showed the
  production picker and resolved the address bar to ordinary `/home`.
- Passed: coverage-write and frontend-review specialist passes; the only
  frontend-review note was a stale verification date, corrected and rechecked.
Completed: 2026-07-21
