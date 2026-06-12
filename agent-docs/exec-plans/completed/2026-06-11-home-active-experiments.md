# Home shows in-progress experiments and history

Goal (incl. success criteria):
- When a member already has experiment runs in their browser vault, the home page shows a "Your experiments" section (in-progress runs first, then recent history) instead of only the blank onboarding empty state.
- Hide the "Start an experiment" onboarding step once an in-progress run exists (direct user feedback from a pilot member).
- Success means a member with an active run sees that run on home with status and a link to its experiment page, and a member with no runs sees the current onboarding state unchanged.

Constraints/Assumptions:
- Private run data stays in the browser vault; all run-derived rendering happens client-side inside the existing `BrowserVaultProvider` seam, mirroring the experiments page.
- Reuse the experiments-page card pipeline (`buildExperimentLibraryCards`) and `ExperimentBrowseCard` instead of inventing new home-only card UI.
- No new persisted state, routes, or APIs.

Key decisions:
- Extract the experiment library card builders from `experiments-page-client.tsx` into a shared `apps/web/src/lib/experiments/library-cards.ts` so home and the experiments page share one card pipeline; add a `runStatus` field so home can split in-progress vs history.
- Render the section inside the existing home browser-vault client component (one provider, one replica load) rather than adding a second provider.

State:
- In progress.

Done:
- Architecture read-through (home page, onboarding steps, experiments page client, browser-vault experiment-run resolution).
- Shared card lib, home section component, home wiring, empty-steps guard.
- Focused tests (onboarding-steps + new library-cards file); apps/web verify lane green.
- frontend-review and coverage-write audits run; all six review findings fixed (history recency sort, loading-gate for the experiment step, image sizes, history-only browse link, split helper moved to library-cards, ledger symbol).

Now:
- task-finish-review, finish-task commit, PR.

Next:
- Visual pass on a vault with real runs (needs authenticated session; flagged in handoff).

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/home/page.tsx
- apps/web/src/components/home/browser-vault-onboarding-steps.tsx
- apps/web/src/components/home/home-experiments.tsx (new)
- apps/web/src/components/home/onboarding-steps.tsx
- apps/web/src/lib/experiments/library-cards.ts (new)
- apps/web/app/(dashboard)/experiments/experiments-page-client.tsx
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
