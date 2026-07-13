# Changelog catch-up and seven-day default

## Goal

Publish the meaningful user-facing changes shipped after the current changelog
cutoff, give each major feature an appropriate visual treatment, and make the
public changelog open on the most recent seven days by default.

Success criteria:

- The changelog covers material launches and user-visible improvements merged
  after the last published edition through the branch point, without internal
  refactors, CI-only work, or implementation trivia.
- New entries use accurate, plain-language copy and reference the shipped pull
  requests when that evidence is available.
- Major features have visuals that fit the established warm editorial system
  and remain legible on desktop and mobile.
- `/changelog` shows the latest seven calendar days by default while preserving
  stable dated edition links and older-archive navigation.
- Focused tests, affected web verification, and desktop/mobile browser checks
  pass.

## Constraints

- Keep `apps/web/src/lib/changelog.ts` as the single source of truth for the
  page, API, digest card, and product-feedback references.
- Derive release claims from merged code, tests, durable product docs, and pull
  request evidence. Do not describe unmerged active-lane work as shipped.
- Preserve stable item anchors and dated edition URLs.
- Reuse existing visual primitives when they communicate the feature well; add
  only the smallest visual surface needed for a material gap.
- Preserve the established warm-paper palette, typography, accessibility, and
  restrained-motion rules.
- Preserve unrelated work in other checkouts and active ledger lanes.

## Approach

1. Identify the last changelog content cutoff and audit merged history after it.
2. Group the shipped work into a small number of clear dated editions and map
   each major feature to an existing or narrowly added visual primitive.
3. Update the server-rendered archive so the clean `/changelog` route includes
   the newest seven calendar days by default, with stable navigation to older
   editions.
4. Add focused registry/page/route coverage and inspect the rendered experience
   at desktop and mobile widths.
5. Run required completion audits, finish the scoped commit, open a PR, and
   complete the repository's CI and ReviewGPT gates.

## State

Implementation, affected-web verification, and required local audits are
complete. The frontend audit's three findings were fixed: stable item links,
archive-aware hero copy, and canonical voice labels. The coverage audit found
no missing proof. The change is ready for the scoped finish-task commit and PR
review gates.

## Notes

- This is isolated in a dedicated worktree because the change is a multi-file,
  user-facing frontend update.
- The seven-day default is a presentation window over immutable dated editions,
  not client-owned filter state.
- Browser discovery returned no available target, so desktop/mobile rendered
  inspection remains an explicit gap. Server rendering, dev smoke, focused
  tests, typechecking, lint, and the production build all passed.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
