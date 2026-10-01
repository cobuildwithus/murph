# Polish goal directory visuals and discovery

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Give every life-stage and sleep goal card one simple, distinct Quiver
  illustration that makes the subject easier to recognize, quiet the category
  artwork without discarding its original colors, and make goal search recover
  gracefully when there is no exact guide. Replace goal-shaped category headers
  with plain taxonomy labels and roomier three-column card grids.

## Success criteria

- All 30 life-stage and 35 sleep route IDs resolve to checked-in SVG
  illustrations.
- The existing Half Ironman goal receives its missing illustration without
  adding a duplicate goal.
- Each subject is concrete, discreet, visually distinct within the category,
  and legible at the card's rendered thumbnail size.
- The set matches the existing goal-card illustration register: cream fills,
  thin dark-green outlines, restrained sage and terracotta accents, no text,
  gradients, frames, shadows, or generic progress symbols.
- Category artwork retains its original illustration and color relationships at
  reduced opacity and saturation rather than becoming a solid silhouette.
- A spaced `iron man` query finds the Ironman guides, and a true no-result query
  offers a visible `Start with Murph` Messages action with the goal prefilled.
- Cardio and Life Stages are each organized into six plain sections, Sleep into
  five plain sections, and family-based directories use non-clickable labels
  while keeping the family root itself as a normal goal card.
- Category card grids use at most three columns so longer titles retain room.
- Goal detail pages show the same goal-specific illustration as their card and
  use muted category artwork only when a goal has no illustration.
- The real category pages render correctly on desktop and phone widths with no
  missing images, clipping, overflow, or accessibility regression.
- The generated illustration manifest and focused goal-card tests pass.

## Scope

- In scope: life-stage and sleep SVG assets, the missing Half Ironman asset, the
  existing generated asset manifest, muted category artwork, goal-search
  normalization and no-result recovery, category-directory taxonomy and layout,
  detail-page artwork fallback behavior, visual review, and focused verification.
- Out of scope: guide copy changes, new illustration infrastructure, pushing,
  merging, or deployment.

## Constraints

- Technical constraints: reuse the existing Quiver batch pipeline and card
  renderer; keep one SVG per route ID; do not add runtime file reads or a new
  dependency.
- Product/process constraints: preserve sensitive-topic dignity; use physical
  objects or compact scenes rather than anatomy-heavy, sexualized, clinical, or
  abstract wellness imagery; keep the work on the existing PR worktree and
  inspect the final diff for private identifiers and credentials.

## Product UX Patch

- Outcome: every life-stage and sleep card gains a fast visual cue; search finds
  common natural phrasing and gives unmatched goals a direct path into Murph;
  plain section labels make it clear which items are selectable goals.
- Reaches: signed-out and signed-in visitors browsing either public category or
  encountering the same cards in search and related-goal lists.
- Proof: render both production category pages and search states at desktop and
  phone widths, inspect all category images at card size, verify the prefilled
  contact link, and confirm titles remain complete accessible labels.

## Risks and mitigations

1. Risk: generated subjects become ambiguous, repetitive, or generic at 48px.
   Mitigation: provide a hand-authored subject for every goal, inspect contact
   sheets and the real page, and regenerate only rejected assets.
2. Risk: sensitive reproductive and sexual-health topics become overly literal
   or uncomfortable.
   Mitigation: prefer care objects, journals, exercise equipment, and quiet
   domestic scenes while retaining enough specificity to distinguish the goal.
3. Risk: paid generation is repeated unnecessarily.
   Mitigation: generate once from explicit subjects, keep accepted files, and
   rerun only concrete visual failures.

## Tasks

1. Inventory the 65 route IDs and assign one distinct, concrete subject to each.
2. Generate both SVG sets in bounded Quiver batches using existing style
   references and the session-scoped credential.
3. Review contact sheets, regenerate rejected assets, then copy accepted SVGs
   into the existing goal illustration directory.
4. Mute category artwork with reduced opacity and saturation, normalize Ironman
   queries, and replace the dead-end empty state with a prefilled Murph action.
5. Use three-column directories, curate plain Cardio, Sleep, and Life Stages
   sections, move family roots into the card grids, and align detail artwork
   with card artwork.
6. Regenerate the route-ID manifest and run focused static, test, typecheck, and
   frontend design-proof checks.
7. Walk both real category pages on desktop and phone, inspect the diff for
   secrets or identifiers, close the plan, and create one scoped commit.

## Decisions

- Keep the existing card component and graceful unknown-ID fallback unchanged.
- Use a single object-led Quiver register across the entire category.
- Avoid text inside artwork and avoid hourglasses, clocks, arrows, checkmarks,
  hearts, and generic journey imagery.
- Keep section headings non-interactive and render family roots, including
  `Sleep Better`, as ordinary cards within their sections. A compact linked
  header experiment was rejected during the live review.
- Curate route-ID sections for Cardio, Sleep, and Life Stages; retain a catch-all
  section so a newly added goal cannot disappear before its taxonomy is updated.
- Keep original category colors visible; reduced opacity and saturation provide
  hierarchy without the loss of detail caused by a monochrome CSS mask.
- Reuse the existing resolved Murph contact option and replace only its body so
  the unmatched search phrase reaches Messages without introducing new routing.

## Verification

- Commands to run: regenerate the goal illustration manifest; validate 65
  life-stage and sleep SVGs plus the Half Ironman asset and route-ID coverage;
  verify the Cardio and Sleep section coverage and goal-specific hero fallback;
  run the focused goal search and visual tests, Web
  typecheck, targeted lint, `pnpm test:frontend-design-proof`, and
  `pnpm complexity:diff`; render the real page at desktop and phone widths.
- Expected outcomes: every route resolves to one valid SVG, all focused checks
  pass, the worktree diff contains only the scoped assets, generated manifest,
  plan artifact, and any required changelog entry, and the walkthrough is Ready.

## Outcome

- Added and visually reviewed 30 Life Stages illustrations, 35 Sleep
  illustrations, and the missing Half Ironman illustration. The existing Half
  Ironman guide was retained without duplication.
- Replaced goal-shaped section links with plain taxonomy labels and ordinary
  cards for every selectable goal, including family roots such as Sleep Better.
- Verified the six Life Stages sections on the live local page at desktop width;
  all 30 goals render in the three-column directory without missing artwork.
- Verified 34 focused tests, Web typechecking, targeted lint, frontend design
  proof, complexity, SVG safety and coverage, responsive overflow, and privacy
  checks. ReviewGPT was not run.
Completed: 2026-09-03
