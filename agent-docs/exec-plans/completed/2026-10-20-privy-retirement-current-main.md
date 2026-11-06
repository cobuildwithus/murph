# Complete Privy retirement on current main

## Outcome and scope
Reconcile PR #3134 with current main, preserving newer authentication, account deletion, and feature retirement behavior. Remove obsolete Privy owners without adding replacement product features. Ship only after the existing live migration and native qualification requirements are satisfied.

## Product UX
Preserve first-party sign-in, session renewal/logout, account recovery, and passkey approval. Existing migrated members retain their accounts. Dormant native installations must have a qualified recovery path. No forced session expiry or deletion of retained members to satisfy retirement.

## Plan
- [x] Reconcile current main and inspect obsolete-provider references and changed owners.
- [x] Run focused auth/deletion tests and relevant typechecks; review the resulting patch.
- [x] Resolve migration convergence and provider obligations through canonical owners; record the operator-approved older-native recovery risk and remaining store-publication boundary.
- [x] Push, review, merge, deploy, verify guarded schema contraction, and remove obsolete project configuration.

## Evidence and decisions
The historical retirement PR already contains guarded contract SQL and an explicit release hold. Current production evidence remains private and is reported only as aggregates in the task conversation. Native release qualification is requested from the operator; code review does not establish distribution or recovery evidence.

## Status
Completed for the authorized runtime/source retirement. Web is live; native source removals are merged. Vendor-app deletion and new native store publication remain explicitly separate, unperformed actions.

## Reconciliation and review retrospective
Current-main conflict resolution preserves native messaging, canonical credential ownership, canary-only diagnostic retention, newer retention categories, and prior feature removals. The shared identity-conflict error keeps current diagnostic reason allowlisting while removing importer-only reasons. Removed the obsolete, unconsumed phone-auth readiness capability instead of retaining its outdated SMS configuration reader. No new state, dependency, authentication fallback, or product surface.

Historical ReviewGPT round 3 passed. The renewed user request to finish and ship retirement, followed by an explicit continue instruction, authorizes continuing this existing task. Current-main changes require a fresh full audit with the original first-reviewed baseline preserved; historical source review does not establish current runtime or rollout proof. The scope remains the same provider retirement, with the existing production hold retained.

## Current verification
- Reconciled non-PostgreSQL selection: 1,870 passed, 25 skipped across 64 files; the database-gated suite is tested separately.
- Follow-up invite/login capability removal: 189 passed across 13 files.
- PostgreSQL selection: 324 passed initially; the one failing passkey fixture needed the production request-IP header under the new rate-limited enrollment owner. The corrected member suite passes all 107 cases, completing 325 cases across 11 suites before contraction.
- All three actual contract-SQL guards reject synthetic live sessions, unimported identities, and pending provider receipts. The actual contraction succeeds on the isolated local database; all 325 cases across 11 suites pass afterward.
- Web and harness typechecks and focused oxlint pass. Hosted harness: 513 passed, one skipped across 33 files. Complexity guard passes; remaining hotspots retain their existing owner boundaries and do not justify unrelated restructuring.
- Current CI found one stale provider field in the native voice test fixture. Removing that field passes the full workspace typecheck and 39 hosted-local scenario helper tests. The opt-in live voice suite imports successfully but skips without synthetic audio and provider configuration; no live voice qualification is claimed.

## Round 4 disposition and authorized correction
Accepted the High finding that active native admission skipped the existing phone welcome/route initializer after an email-only member added their first phone. The parent traced the original completion path, canonical credential commit, consumed activation retry and channel-update effect. The user explicitly resumed after the finding report and authorized correction and fresh review.

Restore the existing idempotent phone welcome call on active admission. Two production lines reuse the current owner without adding state, grants, invites, dependencies or provider compatibility. The composed PostgreSQL regression reproduces the missing route before the fix and passes afterward: actual email OTP login, consent, Starter activation, consumed activation item, native phone verification, repeat admission, one phone welcome, visible Messages action, unchanged invite/credit/grant counts and no device connection. Both affected suites pass all 18 cases; Web typecheck passes. Fresh full review retains the original baseline and prior reviewed head; rollout gates remain independent.

## Subsequent base reconciliation
Main advanced to `f386be0e8ffb8a09f66501b59cf7a7f4a6551e57` while round 5 reviewed `dd2b4396112c948d31ee29128f7372408a94d410`. Resolve the four conflicts by preserving main's Experiments deletion and retirement's obsolete-auth deletion. Keep one copy of three identical first-party browser invalidation tests; no assertion or behavior is lost. Other current-main changes merge through their existing owners. Frozen dependency install, full workspace typecheck, documentation drift, authored-diff whitespace and 94 focused browser-vault/companion tests pass after reconciliation. Apply the new additive game-photo migration only to the isolated synthetic test database. This base update introduces no new retirement behavior and still requires final-head CI; production holds remain unchanged.

## Release disposition
Shipped on 2026-10-21 under the operator-approved retirement disposition. Canonical unused-signup cleanup converged, first-party-only Web passed exact production admission and is live, guarded contraction completed after drain, and read-only catalog checks confirm the retired table/columns are absent. All 14 Privy Vercel settings were removed while preserving the shared session HMAC key. iOS #151, Android #40 and configuration #41 are merged. The current evidence and explicit native/vendor publication gaps are owned by `docs/hosted-auth-migration.md`. No wallet operation, vendor-app deletion, or new store publication is claimed.


## Final closeout

Removed the final two unconsumed synthetic Privy build inputs and their stale
fixture assertion. The deployment admission permissions, ordering, artifact
identity and mandatory private proof are unchanged. Nine artifact-contract tests
pass; source inspection finds no remaining consumer of either input. This is
internal configuration cleanup, not a new authentication or rollout path.
Status: completed
Updated: 2026-10-21
Completed: 2026-10-21
