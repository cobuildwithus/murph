Goal (incl. success criteria):
- Review `packages/setup-cli/**` package-wide for source seams that appear to exist mainly to make tests easier.
- Remove or simplify only clearly unnecessary seams.
- Clean up remaining duplicated test patterns or awkward mocked-import seams within `packages/setup-cli/**`.
- Run focused verification for touched scopes and finish with the required final audit pass.

Constraints/Assumptions:
- Stay inside `packages/setup-cli/**` plus package-local verification config only if required.
- Preserve unrelated dirty worktree edits, especially the existing overlap in `packages/setup-cli/test/setup-assistant-wizard-flow.test.ts`.
- Avoid widening into adjacent packages or shared repo config unless a package-local blocker proves it is necessary.

Key decisions:
- Treat this as a package-scoped standard repo change with focused package verification.
- Prefer test-side dedupe unless a source seam is clearly test-driven and unnecessary.
- Do not rewrite the active overlapping wizard-flow test unless a safe merge is unavoidable.

State:
- in_progress

Done:
- Read repo workflow, verification, and testing docs.
- Confirmed `packages/setup-cli/test/setup-assistant-wizard-flow.test.ts` is already dirty and should be treated as overlap.
- Scanned `packages/setup-cli/src/**` and `packages/setup-cli/test/**` for mocked-import seams and test-driven source exports.

Now:
- Apply the remaining package-local cleanup with clear payoff, then run focused verification.

Next:
- Run the required final audit subagent and close the plan with a scoped commit if the diff stays clean.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether any setup-cli source export is truly test-only; current read suggests no clear candidate worth removing.

Working set (files/ids/commands):
- `packages/setup-cli/src/**`
- `packages/setup-cli/test/**`
- `pnpm --dir packages/setup-cli ...`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
