# Overall AI usage bar

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Show one truthful AI usage bar whose capacity combines unused recurring allowance with purchased usage credit.

## Success criteria

- Settings labels the projection “AI usage” and calculates `used / (used + remaining capacity)`.
- Forecasting and the 80%-used recommendation use the same combined capacity.
- A fulfilled top-up confirmation coexists with the visibly increased remaining percentage.
- Exact internal credit balances stay hidden and Settings performs no redundant credit-projection read.
- Focused tests, canonical acceptance or its documented policy fallback, responsive design proof, and pre-final-gate reviews pass.

## Scope

- In scope: the hosted personal usage projection, Settings usage presentation, fulfilled top-up state, design study, focused tests/selectors, and current product specifications.
- Out of scope: schema or API changes, payment fulfillment behavior, credit-ledger ownership, new state, and separate balance UI.

## Constraints

- Preserve the canonical usage gate as the sole combined-capacity owner.
- Preserve recurring reset-date disclosure while purchased capacity continues to carry forward.
- Preserve hidden exact dollar balances and existing webhook-confirmed fulfillment authority.
- Integrate the supplied patch as behavioral intent and correct any malformed hunk locally.

## Risks and mitigations

1. Risk: percentage or forecast math could divide by the recurring allowance only.
   Mitigation: derive both from `spent + remaining` and add focused credit-backed projection tests.
2. Risk: UI cleanup could remove the reset date or expose exact credit value.
   Mitigation: retain reset copy and assert exact balances and credit-only copy are absent.
3. Risk: fulfilled top-up confirmation could replace rather than accompany the refreshed bar.
   Mitigation: render and test both states together.

## Tasks

1. [x] Apply and reconcile the supplied patch against the exact current `main` head.
2. [x] Inspect the full changed data path and cut inconsistent or obsolete behavior.
3. [x] Run focused diff verification and resolve the full-acceptance lane through the documented scoped fallback when both execution locations are unavailable.
4. [x] Capture desktop/mobile design proof and complete product, specialist, Claude UI, and parent review before the separate final PR gate.
5. [x] Commit and push the PR candidate; hand the clean exact head to the post-plan final ReviewGPT, CI, merge, and worktree-retirement gates.

## Decisions

- Reuse the canonical `remainingUsdMicros` projection rather than adding a separate purchased-credit view.
- Keep one bar and one forecast/recommendation denominator for all currently available usage.

## Verification

- `git diff --check` — passed.
- Focused hosted-web Vitest — 102 tests passed across the usage projection, billing component, Settings page, and design study.
- `pnpm --dir apps/web typecheck:prepared` — passed after generating the repository-owned ignored artifacts required by the worktree.
- Touched-file ESLint — passed.
- `pnpm test:frontend-design-proof` — passed.
- Isolated Playwright viewport proof at 768px and 1280px — 2 tests passed. The first attempt reused an unrelated stale server on the default local port; the isolated-port rerun exercised this worktree.
- Synthetic desktop/mobile catalog captures cover active, purchased-capacity-backed, exhausted, and fulfilled-confirmation-plus-refreshed-bar states. All four hosted proof URLs returned `200 image/jpeg`.
- `product-experience-review` — no findings. Its initial rendered-evidence gap for the fulfilled confirmation plus refreshed bar was resolved with the real-component catalog preview and browser captures.
- Claude Fable UI double-check — explicit usage-credit exhaustion; no further Claude attempt is permitted by the completion workflow.
- One broad hosted-web verification pass completed 7,111 tests, lint, dev smoke, typecheck, and production build. Because the catalog proof changed while that pass was running, it is supporting evidence rather than the exact stable-candidate gate.
- Exact reconciled-head `pnpm test:diff apps/web/src/lib/hosted-execution/usage-status.ts apps/web/src/components/settings/hosted-billing-settings.tsx 'apps/web/app/(dashboard)/settings/page.tsx' apps/web/app/design/group-usage-funding-study.tsx` — passed: 539 files passed / 13 skipped, 6,923 tests passed / 191 skipped, TypeScript passed, ESLint completed with zero errors and 13 pre-existing warnings, dev smoke passed, and the production build passed.
- The fulfilled-state evidence-only retry now uses unobscured desktop and mobile compositions of the real 55% used / 45% remaining band and the real fulfilled dialog. Both hosted proof URLs returned image responses.
- Preliminary `completion-specialists` ReviewGPT — `PASS` on `59a715178c`; prompt lens not applicable, frontend and coverage lenses applicable, no findings, and no patch artifact. The first attempt was `INVALID` only for obscured rendered evidence and was retried on the unchanged head after correcting that evidence.
- Parent final review — no findings after re-reading the full production/test/spec diff, walking the canonical gate-to-projection-to-Settings path, and checking stale credit-projection references.
- `pnpm verify:acceptance` could not produce trustworthy completion. The required remote fallback failed before provisioning because the installed Blacksmith Testbox delegate rejected the dispatcher's documented `--stop-after` option. One local attempt was discarded after temporary Playwright evidence cleanup raced ESLint's ignored-output scan; the later clean attempt spent the full admission window behind an unrelated existing web verification and was stopped as the verification guide requires.
- Scoped verification mode therefore replaces the repo-wide baseline for this narrow `apps/web` projection/presentation change: the exact reconciled-head `test:diff` completed the full web tests, typecheck, lint, dev smoke, and production build; focused and viewport proof passed; and every latest-head GitHub check is green.
- Final ReviewGPT, merge-conflict proof, merge, and worktree retirement remain the post-plan PR gates required by the completion workflow.
Completed: 2026-07-27
