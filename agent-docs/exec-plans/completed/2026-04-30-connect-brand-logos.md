# Connect Brand Logos

## Goal

Add high-quality brand logo assets for the `/connect` device cards and render them from `apps/web/public` instead of text initials.

## Constraints

- Scope stays limited to the hosted web `/connect` page, focused tests, public logo assets, and plan/ledger coordination.
- Preserve unrelated dirty work in the shared checkout.
- Use organized public assets under `apps/web/public`.
- Do not add dependencies.

## Files

- `apps/web/app/(dashboard)/connect/page.tsx`
- `apps/web/public/brand-logos/connect/**`
- Focused `apps/web/test/**` coverage if needed
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification

- Focused hosted web test for `/connect` logo rendering.
- Hosted web typecheck or scoped diff verification if the broader lane is blocked by unrelated dirty work.
- Browser check for desktop and mobile if a local server can run cleanly in this checkout.

## State

- Done: downloaded local Strava, Apple Health, WHOOP, and Oura assets under `apps/web/public/brand-logos/connect`.
- Done: wired those assets into `/connect` device cards with accessible image labels.
- Done: added focused render coverage for local logo paths and asset existence.
- Done: fixed the frontend-review mobile overflow finding by allowing the card grid and card contents to shrink at narrow widths.
- Done: focused test, hosted-web typecheck, touched-file diff check, live route proof, and Chrome desktop/mobile screenshot checks were run. Scoped app verify remains blocked by unrelated existing hosted-web lint/test failures.
- Done: closed the active coordination row and archived this plan.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
