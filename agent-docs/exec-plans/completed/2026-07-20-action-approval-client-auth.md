Goal (incl. success criteria):
- Prevent secure action approvals from timing out when Murph's durable app session is valid but the current browser no longer has an authenticated Privy client session.
- Success means the approval screen preserves the existing first-click hydration wait, offers the existing same-device reauthentication flow once Privy reports an unauthenticated client, and does not issue a server challenge from that known unauthenticated state.

Constraints/Assumptions:
- Preserve the existing approval binding, passkey-only MFA, exact embedded-wallet selection, signature verification, and server session checks.
- Reuse the shared auth dialog and current-page resume behavior; add no new auth owner or persisted state.
- Keep approval identifiers, member identifiers, wallet addresses, and private presentation data out of tests, docs, and logs.

Key decisions:
- Treat the app session and Privy browser session as separate readiness facts, using the existing shared-auth control behavior.
- Gate the approval action before challenge issuance once Privy has finished loading and reports that the browser is unauthenticated; preserve the existing first-click wait while client state is still initializing.
- Stop an in-flight hydration wait immediately if Privy resolves to a known unauthenticated state, so the shared sign-in action becomes usable without another timeout.
- Leave the connected-wallet hydration wait in place for already-authenticated clients.

State:
- Implementation, scoped verification, and required local audits are complete; final review and PR delivery remain.

Done:
- Read required architecture, security, reliability, frontend, product, verification, approval protocol, Privy, and browser-control guidance.
- Confirmed production approval remains pending with the expected Privy identity and embedded Ethereum wallet.
- Confirmed the failed click reached server challenge issuance and then stopped before a decision.
- Traced the missing branch: the shared `AuthButton` already supports same-device reauthentication for an app-authenticated page whose Privy client is unauthenticated, while the approval card bypassed it and started an unresolvable readiness wait.
- Added the shared-auth-dialog gate for a known unauthenticated Privy client without changing server challenge, signature, or wallet-selection contracts.
- Made the readiness wait stop immediately when Privy resolves to a known unauthenticated state, allowing the sign-in recovery action to become usable after a fast first click.
- Added component and hook regressions for stable signed-out state, transient hydration, ready-without-user exit, enabled sign-in recovery, and no second challenge.
- Passed the focused four-file Vitest lane with 19 tests.
- Passed `pnpm test:diff` for the touched web source/tests: dependency and architecture/privacy guards, TypeScript 7 web check, 5,913 tests, lint with zero errors, dev smoke, and the Next production build.
- Frontend review found one fast-click timing issue; fixed it and completed a clean re-audit with no findings.
- Coverage-write found the existing paired hook/component proof sufficient and made no edits.
- Fable and Opus UI double-check attempts were both blocked by an expired Claude OAuth session.

Now:
- Re-read the final diff and call paths, reconcile current `main`, close the plan, and commit the scoped patch.

Next:
- Open the PR, start ReviewGPT concurrently with CI, resolve any accepted findings, and prove mergeability against current `main`.

Open questions (UNCONFIRMED if needed):
- Browser interaction proof is unavailable in this session because no in-app browser target is present; cover the state with component behavior tests and report the browser-proof limitation.

Working set (files/ids/commands):
- `apps/web/src/components/sensitive-actions/action-approval-card.tsx`
- `apps/web/src/components/sensitive-actions/use-passkey-wallet-mfa.ts`
- `apps/web/test/action-approval-client-auth.test.tsx`
- `apps/web/test/action-approval-card-accessibility.test.tsx`
- `apps/web/test/action-approval-passkey-wallet-mfa.test.tsx`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/action-approval-client-auth.test.tsx apps/web/test/action-approval-card-accessibility.test.tsx apps/web/test/action-approval-passkey-wallet-mfa.test.tsx apps/web/test/auth-dialog-provider.test.tsx --no-coverage`
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
