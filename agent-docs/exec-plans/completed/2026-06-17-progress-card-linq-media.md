# Progress Card Linq Media Delivery

## Goal

Make experiment progress-card image URLs render through Linq/iMessage media delivery.

## Evidence

- Static `www.withmurph.ai` image URLs render through Linq.
- Dynamic progress-card URLs return `200 image/png` in browser/curl and Linq accepts them, but iMessage does not render the image.
- Main response-shape difference: progress cards are dynamic Next `ImageResponse` output without the static-file headers Linq successfully handles.

## Scope

- `apps/web/app/(dashboard)/experiments/[experimentId]/progress-card/[payload]/route.tsx`
- Focused route/header tests if an existing test owner fits.
- Existing progress-card URL contract tests as needed.

## Out Of Scope

- Linq API redesign.
- Assistant response-media tool changes.
- Experiment card visual redesign.

## Verification

- Focused route/header regression.
- Focused progress-card URL/contract tests.
- Required scoped typecheck/test lane for touched app or documented blocker.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
