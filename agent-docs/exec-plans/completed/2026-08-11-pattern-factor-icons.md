# Personal Pattern Factor Icons

## Goal

Give each known Personal Patterns activity or intervention a relevant custom
illustration. Make the comparison table readable without horizontal scrolling
on a phone.

## Constraints

- Keep provider data and pattern detection unchanged.
- Use custom Quiver SVG illustrations that match Murph's visual style.
- Cover every current WHOOP sport name through semantic groups.
- Keep unknown activities and interventions readable through explicit fallbacks.
- Keep the desktop comparison table unchanged.
- Show at most three outcomes per compact mobile table.
- Render the production component in the existing design catalog study.

## Working Set

- `apps/web/public/design-assets/patterns/*.svg`
- `apps/web/src/components/overview/pattern-factor-icon.ts`
- `apps/web/src/components/overview/personal-patterns-section.tsx`
- `apps/web/app/design/personal-patterns-study.tsx`
- `apps/web/test/pattern-factor-icon.test.ts`

## Verification Plan

- Focused resolver tests, including the full current WHOOP sport list.
- Web typecheck and focused Personal Patterns tests.
- Desktop and mobile browser proof from the design catalog.
- Preliminary frontend and coverage ReviewGPT lenses on the pushed PR head.
Status: completed
Updated: 2026-08-11
Completed: 2026-08-11
