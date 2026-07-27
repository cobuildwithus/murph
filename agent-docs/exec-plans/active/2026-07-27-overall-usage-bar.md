# Overall AI usage bar

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Show one truthful AI usage bar whose capacity combines unused recurring allowance with purchased usage credit.

## Success criteria

- Settings labels the projection “AI usage” and calculates `used / (used + remaining capacity)`.
- Forecasting and the 80%-used recommendation use the same combined capacity.
- A fulfilled top-up confirmation coexists with the visibly increased remaining percentage.
- Exact internal credit balances stay hidden and Settings performs no redundant credit-projection read.
- Focused tests, canonical acceptance, responsive design proof, required reviews, and PR merge gates pass.

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
3. [ ] Run focused diff verification and full acceptance.
4. [ ] Capture desktop/mobile design proof and complete product, specialist, Claude UI, parent, and final cross-cutting review.
5. [ ] Commit, open and merge the PR, then retire the task worktree.

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
- Exact stable-candidate `pnpm test:diff ...` — waiting for the shared host slot.
- `pnpm verify:acceptance`, preliminary specialists, final ReviewGPT, PR CI, merge-conflict proof, merge, and worktree retirement — pending.
