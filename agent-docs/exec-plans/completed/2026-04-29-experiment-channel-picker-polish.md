Goal (incl. success criteria):
- Audit the experiment Start channel picker behavior and polish the picker UI so it matches `/design` and the Murph lab-notebook style.
- Success: picker remains auth-gated, preserves privacy-minimized contact routing, clearly explains the available channels, looks deliberate on desktop/mobile, and focused tests pass.

Constraints/Assumptions:
- Preserve unrelated dirty work and active experiment/Health Commons rows.
- Do not serialize raw user contact identifiers to client props or UI.
- Keep implementation inside existing shadcn/base UI and apps/web design tokens.

Key decisions:
- Treat this as a UI polish over the existing resolver, not a routing/back-end redesign.
- Keep the write scope to `StartExperimentButton` and direct focused tests unless verification proves more is needed.

State:
- Complete.

Done:
- Read frontend/design docs and current picker implementation.
- Polished the channel picker dialog for desktop/mobile and added a `/design` preview.
- Updated focused tests for dialog copy, option counts, and privacy-preserving rendered output.
- Ran focused test, lint, typecheck, diff check, browser proof, and required review passes.

Now:
- Closing the plan and committing the scoped diff.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/components/experiments/experiment-detail/start-experiment-button.tsx`
- `apps/web/app/design/components-content.tsx`
- `apps/web/test/start-experiment-button.test.ts`
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
