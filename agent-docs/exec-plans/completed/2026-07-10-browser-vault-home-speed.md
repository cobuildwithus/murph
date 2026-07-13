# Browser Vault Home Speed

## Goal

Make the authenticated landing-to-`/home` transition feel immediate while preserving browser-vault privacy and freshness. Success means internal navigation starts without a hard document reload, dashboard routes share one decrypted in-memory replica, an authenticated landing page can warm that replica before navigation, stale data remains visible during background revalidation, and avoidable server-side session/billing work is removed from the home critical path.

## Constraints

- Keep browser-vault health data in memory only. Do not add local storage, session storage, IndexedDB, Cache Storage, cookies, service workers, or another persisted cache.
- Preserve fail-closed auth, legal-consent, member ownership, replica signature, decryption, and freshness checks.
- Preserve the existing server-owned stale-while-revalidate contract: usable stale replicas may be served, refresh is requested after the browser response, and empty or unauthorized results clear client state.
- Keep the hosted runtime and refresh scheduler unchanged unless direct proof shows the current owner contract cannot satisfy this user-visible improvement.
- Prefer deletion and one owner over wrappers, new dependencies, or a generalized cache.
- Preserve the recovered user-facing implementation exactly where it satisfies the verified architecture; the parent retains review, verification, commit, and PR ownership.
- Keep browser, local audit, and ReviewGPT work serialized through the active recovery authorization so shared lanes are not duplicated.
- Preserve unrelated worktree and coordination-ledger rows.

## Key Decisions

- Lift `BrowserVaultProvider` to the persistent dashboard layout and remove route-local provider wrappers.
- Add one bounded module-memory ready snapshot and one in-flight request, guarded so logout or auth loss cannot be repopulated by an older request.
- Use one data-free same-origin browser signal to clear the module snapshot and mounted client whenever the shared app-session cookie is revoked or replaced in this or another tab.
- Warm the browser-vault module only for an authenticated landing member and load that code conditionally so anonymous landing bundles do not pay for the vault client.
- Use Next.js internal navigation and a route loading boundary for immediate transition feedback.
- Delete avoidable `/home` critical-path reads rather than introduce server caching.

## Plan

1. Reconfirm current `origin/main`, browser-vault ownership, home loaders, tests, and overlapping active work.
2. Implement the persistent provider, safe in-memory warm path, internal navigation, loading boundary, and narrow server query reductions.
3. Add focused regressions for cache lifetime, request deduplication, auth clearing, provider ownership, navigation, and server query shape.
4. Run the truthful app/repo verification lane. Defer direct browser scenarios to the controller-gated browser-review phase.
5. Run security/privacy, frontend, and coverage completion audits; resolve every accepted finding and perform the parent final review.
6. Finish the scoped commit, push, open a draft PR, and prove exact-head CI and mergeability before the final ReviewGPT gate.

## Verification

- Focused `apps/web` Vitest files while iterating.
- `pnpm test:diff` for the final touched `apps/web` paths when it truthfully selects the app lane; otherwise `pnpm verify:acceptance`.
- `git diff --check` and privacy/path review before commit and upload.
- Direct landing-to-home, stale-display, background-refresh, logout, desktop, and mobile browser checks only after controller grant.
- Exact-head GitHub CI and mergeability proof before the controller-gated ReviewGPT/browser phase.

## State

Implementation and all specialist remediation are complete: the authenticated landing page conditionally warms one bounded in-memory browser-vault store; the persistent dashboard layout owns one provider; stale ready data survives failed background revalidation; auth loss/logout clears decrypted state; internal links and a dashboard loading boundary improve transition feedback; and the home path uses narrower session, device-connection, and billing reads. Security passes fixed cross-tab stale-client, response-header ordering, render-to-subscription, navigation/focus authority, logout, and account-deletion invalidation gaps with the existing data-free signal and authority boundaries. The frontend pass fixed unauthorized recovery, cold-load error state, loading accessibility, and reduced-motion behavior. The coverage-write pass added only two direct assertions: the real cross-tab publisher emits exactly the data-free token, and every decorative animated loading skeleton has a reduced-motion fallback. Focused proof passes 89 of 89 implementation tests plus 6 of 6 coverage tests; targeted lint and web typecheck pass; diff and privacy hygiene are clean. The latest diff-aware web lane passed guards, development smoke, lint, compile, TypeScript, page-data collection, and 4,298 tests across 384 files, then exited only because unrelated OpenGraph image routes exceeded the static-generation timeout. The shared in-app browser had no allocatable session, so rendered desktop/mobile inspection remains an explicit evidence gap rather than a guessed result. The current user authorization permits the remaining scoped commit, main reconciliation, PR, exact-head CI, and final ReviewGPT path.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
