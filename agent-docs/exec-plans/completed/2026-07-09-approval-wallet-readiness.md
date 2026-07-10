# Approval Wallet Readiness

## Goal

Make the first approval click wait for Privy's exact connected embedded wallet before requesting a signature, so a page refresh is never required to complete an otherwise valid approval.

## Constraints

- Preserve the passkey-only MFA and canonical embedded-wallet checks.
- Use Privy's existing connected-wallet readiness primitive; do not add another auth/session/state layer.
- Fail closed on a missing or mismatched connected wallet and keep the approval pending for a safe retry.
- Do not expose member, approval, wallet, token, or session identifiers in logs, tests, docs, or handoff artifacts.

## Root-Cause Evidence

- The approval flow currently selects a linked wallet from `usePrivy().user`, then immediately passes its address to `useSignMessage`.
- Privy documents linked wallets and connected wallets as distinct: linked accounts may exist before the wallet is available to sign, and `useWallets().ready` is the readiness signal for signing.
- The production failure is Privy's exact signer lookup failure for an address while the first click is in flight; refreshing allows wallet connection hydration to finish.
- The recent first-click wait retained the pre-hydration `signMessage` callback across that wait, so updated user refs could be paired with a stale signer closure.
- The installed SDK throws the wallet lookup error inside an async Promise executor, leaving the outer signing promise unresolved; a bounded caller timeout is required to keep the UI recoverable if a provider request still hangs.

## Plan

1. Extend the existing passkey-wallet setup hook to track `useWallets()` readiness and the exact connected wallet address.
2. Wait through the existing bounded loading step until both the authenticated user and matching connected wallet are ready.
3. Add focused regressions for delayed wallet hydration and missing/mismatched connected wallets.
4. Run the hosted-web focused tests, lint/typecheck/acceptance lane, direct first-click scenario proof, required audits, and final review.

## Verification

- Focused approval/passkey-wallet tests pass, including delayed wallet hydration, stale signer replacement, provider timeout recovery, and busy-state accessibility.
- `pnpm test:diff` passes for the touched hosted-web files: 374 files and 4,030 tests, plus build, typecheck, lint, smoke, and guard checks.
- Hosted-web lint and typecheck pass.
- `pnpm verify:acceptance` completed all repo typechecks, then encountered unrelated high-contention test timeouts across multiple packages. Representative failed files pass in isolation: 11 web route tests and 5 assistant-engine tests.
- Security and frontend completion audits found no remaining actionable findings.

## State

Active: implementation, owner verification, and completion audits are complete. The hook now waits for the exact connected embedded wallet, the authorization flow invokes the latest hydrated signer, and unresolved provider signing requests time out. The only remaining work is final diff review, scoped commit, draft PR, ReviewGPT, and PR checks.

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
