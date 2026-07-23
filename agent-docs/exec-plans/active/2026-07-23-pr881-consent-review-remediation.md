# PR 881 consent deep-review remediation

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Land the supplied deep-review remediation on PR 881 while preserving explicit, fail-closed launch consent and a clear decline path.

## Success criteria

- The consent card owns both accept and decline actions without an extra wrapper.
- Partial launch-scope acceptance is retained in the client so retry records only the remaining scope.
- The auth dialog presents consent-specific accessible copy and returns to auth on decline without recording consent.
- Homepage entry points retain the passive legal notice, focused tests and canonical verification pass, and required frontend/review gates complete.

## Scope

- In scope: hosted auth dialog/panel, launch consent card and design catalog, focused web tests, and the consent design-proof validator.
- Out of scope: consent API semantics, stored consent schema, optional feature-consent behavior, legal document content, and unrelated onboarding flows.

## Constraints

- Keep `apps/web` as the sole owner of hosted consent state and fail closed before private hosted data access.
- Preserve one explicit affirmative action, a reachable decline action, and separate just-in-time optional feature consent.
- Prefer deletion and existing shadcn/Base UI primitives; add no new dependency or state owner.

## Risks and mitigations

1. Risk: a partial two-scope write could cause duplicate legal acceptance on retry.
   Mitigation: retain the latest returned status locally and cover the exact retry sequence.
2. Risk: decline or completion state could leave the dialog visually or behaviorally stuck.
   Mitigation: make pending states mutually disabling, clear pending auth in `finally`, and cover decline plus view transitions.
3. Risk: compact dialog actions or document links could overflow narrow screens.
   Mitigation: keep min-width-safe grid actions and refresh desktop/mobile design proof.

## Tasks

1. Reconstruct and apply the supplied patch against the exact PR head, resolving drift by intent.
2. Review the resulting component ownership, accessibility, responsive layout, and consent invariants.
3. Run focused tests, typecheck, canonical diff verification, and responsive design proof.
4. Complete the required product, specialist, Claude UI, final ReviewGPT, and CI gates.
5. Commit and push the exact reviewed head to PR 881, then close the plan.

## Decisions

- Treat the supplied patch as behavioral intent because its blob context does not exactly match the current PR head.
- Delete the single-purpose action wrapper and move decline ownership into the existing consent prompt.
- Reset the existing auth-completion state on decline so clearing the consent gate returns to auth instead of exposing a stale finishing state.

## Verification

- `pnpm test:diff <touched web and design-proof paths>`: passed (421 repo-tool tests; 6,222 web tests passed and 154 skipped; web typecheck, lint, smoke, and production build passed).
- `pnpm test:frontend-design-proof`: passed (10 tests).
- Focused Vitest: passed (4 files, 52 tests) after the product-review recovery fixes.
- Scoped web ESLint: passed.
- Rendered `/design?tab=consent` with the production component at 1440 px and 390 px; direct overflow checks also passed at 320 px.
- Interactive catalog proof confirmed pending feedback disables both launch actions and restores them after completion.
- `product-experience-review`: two recovery findings accepted and fixed; re-review returned `NO FINDINGS`.
- Claude Code UI double-check: Fable stopped at explicit usage-credit exhaustion; per policy no fallback request was made.
- Cloudflare Images upload: blocked because the local least-privilege Images credentials are unavailable; ignored local evidence is retained for ReviewGPT packaging.
- Preliminary specialist ReviewGPT, final verification, plan closure, final ReviewGPT, and current-head CI remain pending.
