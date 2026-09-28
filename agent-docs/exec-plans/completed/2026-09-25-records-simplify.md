# Medical records simplification

## Outcome and invariants
Make saved records and the next useful action clear at a glance. Preserve truthful partial, failed, active, disconnected and reconnect states, import limits, lab availability, confirmation, and saved-data retention. The existing records client remains the presentation owner; no backend or authority changes.

## Evidence and approach
The current row repeats status and shows import bookkeeping and disconnect alongside routine actions. Compare independent Fable 5.1 and Opus 5.5 HTML studies using synthetic data; adapt the strongest composition to existing production components. Use native disclosure for secondary detail, existing links and confirmation logic. No new dependencies or persisted state.

## Product UX
Effort: medium. Returning members see latest import outcome and lab access; partial/failed imports retain honest recovery; active imports retain progress; disconnected sources retain saved results; new members can import; privacy and disconnect remain reachable. Replay desktop and phone, keyboard disclosure and disconnect confirmation. Verdict: Ready.

## Work
- [x] Compare independent rendered model designs.
- [x] Simplify production page and refresh synthetic design representation.
- [x] Run focused client tests, Web typecheck, rendered responsive and interaction proof.
- [x] Review diff and complexity, decide changelog, close plan and commit.

## Completion
Independent Fable 5.1 and Opus 5.5 studies used the same synthetic brief. Fable had the shorter, calmer composition; Opus emphasized retry but repeated more explanatory copy. The implementation reduces both detail sections to one, keeps latest-run count and terminal status visible, and promotes lab access. Original studies and comparison gallery remain ignored local artifacts, not shipped code.

Evidence:
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/clinical-records-pages-client.test.tsx`: 26 passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`: 10 passed after generated fragment preparation.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir apps/web exec playwright test e2e/pr-records-overview-design-proof.spec.ts --config playwright.config.ts --project chromium --workers 2`: 2 passed with task-isolated server. Phone and desktop rendering inspected; no overflow. Keyboard disclosure, saved-reference explanation, retained-data confirmation and cancellation, and privacy disclosure passed on real production components with synthetic inputs.
- `pnpm complexity:diff`: passed, maximum changed function complexity decreased from 19 to 18; no hotspots above 20.
- `git diff --check`: passed. Parent reviewed state semantics, routing, retained confirmation logic and authored privacy boundary.

Production component representation: `/screenshots/health#records-overview`. Partial status remains visible; active import progress, failed/no-new-results/reconnect/disconnected states, import limits, and existing disconnect response protections are covered by the focused client suite. No backend, authorization, import behavior or deployment change. Frontend-only scope is exempt from final ReviewGPT. Local scoped commit only; no PR, CI or deployment claimed.

Changelog: `simpler-medical-records`. Source PR list remains empty until a PR exists. No repository-actionable friction was introduced; initial test invocation and generated-fragment ordering mistakes were corrected within the task.

Status: completed
Updated: 2026-09-25
Completed: 2026-09-25
