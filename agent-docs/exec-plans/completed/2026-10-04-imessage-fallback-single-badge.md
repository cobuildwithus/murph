# iMessage Fallback Single Badge

Status: completed
Created: 2026-10-04
Updated: 2026-10-04

## Goal

- Static iMessage card fallbacks show one Murph badge, not Messages' App Store
  art stacked over a second mark painted into the bitmap.

## Success criteria

- Nutrition, compact-table, and challenge-standings fallback PNGs paint no Murph
  mark and keep the native 36×27pt upper-left badge footprint empty.
- Card content, header placement, and image sizes are unchanged.
- The card image route no longer reads, traces, or guards the mark SVG.

## Scope

- In scope: fallback image chrome and components, the stateless image route,
  OG asset trace includes and guards, focused tests, and owner docs.
- Out of scope: the Linq request (`app_store_id` stays for one-tap install),
  native extension rendering, and the Messages-drawn badge's own letterboxing.

## Constraints

- Technical constraints: keep the badge footprint reserved so Messages' art
  lands beside the title and above the calorie total as before.
- Product/process constraints: preserve the App Store install affordance added
  by #3584.

## Risks and mitigations

1. Risk: a recipient path where Messages draws no badge now shows an empty corner.
   Mitigation: every Linq app-card request carries the App Store id, which is
   what makes Messages draw the art; the empty corner matches the native gutter.

## Tasks

1. Replace the painted badge with an empty footprint in the shared chrome.
2. Remove `logoSrc` plumbing and the mark read from the image route.
3. Drop the mark from OG trace includes, trace guards, and asset path tests.
4. Update fallback image tests and the owner docs.

## Decisions

- Keep `app_store_id`; remove the bitmap mark (user decision, 2026-10-04).
  Root cause: #3584 added the App Store id after the bitmap mark was designed
  for requests without it, so Messages now draws its own badge on top.

## Verification

- Commands to run: focused Vitest for `imessage-nutrition-card-image` and
  `og-asset-paths`, web typecheck, eslint on changed files, `pnpm docs:drift`,
  and a rendered nutrition PNG readback through the route.
- Expected outcomes: all pass; the rendered PNG has no mark and an empty
  upper-left footprint.
Completed: 2026-10-04
