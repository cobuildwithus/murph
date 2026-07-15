# AI model choice redesign

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make the Settings model choice easy to understand at a glance, with concise
  tradeoffs and a calmer visual hierarchy.
- Extract the selection treatment into the shared UI system and document it on
  the live design page.

## Success criteria

- Luna, Terra, and Sol have distinct, plain-language purposes without vague or
  repetitive copy.
- Selection, hover, focus, disabled, saving, unavailable-plan, and saved states
  remain accessible and visually legible on desktop and mobile.
- The production form keeps its existing model eligibility, persistence, and
  dormant-Sol behavior.
- Reusable radio-group, choice-card, and spinner primitives appear on `/design`.
- Focused tests, scoped app verification, browser proof, and required frontend
  and coverage audits pass with no unresolved accepted findings.

## Scope

- In scope: the hosted assistant model settings component, shared choice-card
  UI primitives, the design-page component showcase, focused component tests,
  and the matching visual design-system documentation.
- Out of scope: model eligibility, pricing, billing behavior, API contracts,
  reasoning controls, or hosted runtime selection semantics.

## Constraints

- Preserve the existing server-owned model and Edge eligibility rules.
- Add no dependency or persisted state; use the current Base UI/shadcn stack.
- Keep the solution small and reusable without creating a settings framework.
- Preserve unrelated active ledger rows and working-tree changes.

## Tasks

1. Add the canonical Base UI radio-group and spinner primitives plus a small
   choice-card composition that exposes semantic selected, disabled, and
   description states.
2. Rebuild the model form with the shared choice-card pattern and rewrite the
   model and status copy.
3. Add interactive choice-card and radio-group examples to `/design` and update
   `DESIGN.md` with the reusable pattern.
4. Extend focused tests, run scoped verification and browser checks at desktop
   and mobile sizes, then complete required audits and the parent final review.
5. Close this plan and commit the exact scoped change.

## Verification

- `pnpm test:diff apps/web/src/components/settings/hosted-assistant-model-settings.tsx apps/web/src/components/ui/choice-card.tsx apps/web/src/components/ui/radio-group.tsx apps/web/src/components/ui/spinner.tsx apps/web/app/design/components-content.tsx apps/web/test/hosted-assistant-model-settings.test.tsx`
- Direct browser inspection of Settings model states and
  `/design?tab=components` at desktop and mobile widths.
- `git diff --check` and identifier/secret-safe final diff review.

## Outcome

- Replaced the flat settings rows with responsive shared choice cards and
  clearer purpose, usage, current, draft, unavailable, saving, and status copy.
- Added shared Base UI radio-group, choice-card, and spinner components plus
  interactive `/design` examples and durable design guidance.
- `pnpm test:diff` passed after the final remediation: web typecheck, production
  build, lint, dev smoke, 5,213 tests, and workspace guards passed. Existing
  lint and build warnings remain unchanged.
- Frontend review found one accessibility gap in the radio description chain;
  the fix now announces usage metadata and the locked Sol reason. The focused
  remediation review and coverage-write follow-up both passed with no remaining
  findings.
- The full isolated stack is live at the worktree's assigned local URL and the
  design page returns HTTP 200. The in-app browser backend was unavailable, so
  desktop/mobile visual inspection remains an explicit verification gap for the
  user-visible live review rather than a claimed pass.
Completed: 2026-07-15
