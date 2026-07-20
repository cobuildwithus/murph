Goal (incl. success criteria):
- Restore the completed-experiment review path so a member can open a protocol they previously ran and view that run's private results without losing the public protocol/research context.
- Reuse the canonical experiment run, outcome analysis, browser-vault projection, and route-tab patterns; add no new persisted product state or duplicate analysis owner.
- Success means a completed tracked run exposes a clear results tab/state on the experiment detail page, the user's supplied vault structure reaches that state, missing or still-pending results are explained honestly, and focused tests plus desktop/mobile browser proof cover the path.

Constraints/Assumptions:
- Keep private run data private and member-bound; public Health Commons content must not absorb raw personal results.
- Prove the root cause from vault evidence, current code, and recent history before choosing the fix.
- Prefer deletion, derivation, or an existing projection field over a new API, store, schema, or lifecycle mechanism.
- Preserve unrelated working-tree and coordination-ledger work, including the separate experiment library status and assistant lifecycle-card lanes.
- Follow `agent-docs/FRONTEND.md`, `PRODUCT.md`, and `DESIGN.md`; verify desktop and mobile states.

Key decisions:
- Treat the protocol page as a stable public knowledge surface with a member-private results view when an exact tracked run is available.
- Keep route/tab state linkable and accessible rather than hiding results in a modal or replacing protocol content.

State:
- Completed locally; PR validation is next.

Done:
- Read the repository architecture, product, experiment outcome, frontend, verification, and completion contracts.
- Proved the supplied completed run and saved outcome are intact and satisfy current schemas; the browser projection reconstructs the comparisons, schedule, and context needed by the existing results UI.
- Traced the regression to the removal of the Results route/tab and the active-or-paused-only replacement filter.
- Restored the linkable Your results route using the existing public results projection, dashboard browser-vault owner, run resolver, and ResultsTab component.
- Added durable route/data-source documentation and focused route, provider-ownership, projection, completed-run, and navigation regression coverage.
- Covered canonical and alias navigation, exact and newest-completed run selection, partial stopped runs, provider ownership, public/private bundle boundaries, and responsive containment.
- Passed 56 focused tests after audit remediation, the full diff-aware repository gate, 5,383 web tests, TypeScript, lint, prepared dev smoke, and the production build.
- Proved the completed low-confidence result at 1440px and 390px with no horizontal overflow.
- Completed the required frontend and coverage reviews; resolved the alias-route selection, partial stopped-run context, and focus-ring containment findings, with no accepted findings remaining.

Now:
- Close the active plan and create the scoped task commit.

Next:
- Reconcile with current `main`, open the task PR, and run CI with ReviewGPT against the exact pushed head.

Open questions (UNCONFIRMED if needed):
- None for the reported single completed-run path. Multi-run history selection remains a separate product/query enhancement.

Working set (files/ids/commands):
- apps/web/app/experiments/**
- apps/web/src/components/experiments/**
- apps/web/src/lib/experiments/**
- apps/web/test/**/*experiment*
- packages/query/src/browser-vault/**
- packages/query/test/browser-vault-experiment-results.test.ts
- agent-docs/product-specs/protocol-outcome-network.md
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
