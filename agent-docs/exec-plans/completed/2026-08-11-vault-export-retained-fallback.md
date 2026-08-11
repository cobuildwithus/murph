# Restore Retained Vault Export

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Let an authenticated member download the latest retained browser-vault replica when newer health changes are still processing.
- Keep the export truthful about possible missing recent changes.
- Preserve the existing MFA-bound authorization, member binding, encryption, and consent rules.

## Evidence

- Production returned `409 BROWSER_VAULT_SESSION_NOT_FRESH` for two export attempts on 2026-08-11.
- The Settings dialog promises the latest retained dashboard data and already warns that recent unprocessed changes may be absent.
- The route currently rejects an existing retained replica when source state moved, the replica exceeded its freshness window, or device import is pending.

## Plan

1. Make the export route serve an existing compatible retained replica while it schedules a refresh for stale or pending source state.
2. Keep missing or unreadable retained replicas retryable and keep withdrawn-consent processing asleep.
3. Add focused route and client tests for stale and pending retained exports.
4. Update the durable export contract, run focused proof, and complete the PR review path.

## Invariants

- The browser receives only the authenticated member's encrypted replica.
- Export still requires the current one-time `vault.export` authorization.
- The challenge is consumed only after the encrypted replica is fetched.
- A missing replica never becomes an empty or fabricated export.
- Health-data withdrawal never wakes processing.

## Decisions

- Serve the newest compatible retained replica when newer source work is pending instead of blocking the export on freshness.
- Keep refresh as best-effort continuation through the existing hosted signal path.
- Read current health-data consent inside the deferred refresh task and stop unless consent remains granted.
- Add no new queue, export format, state owner, or dependency.

## Verification

- Focused route, Settings UI, and design-study tests: 65 passed.
- Web TypeScript check: passed.
- Diff whitespace check: passed.
- Desktop and mobile design-study renders: inspected at 2368 × 844 and 1050 × 2085.
- Preliminary specialist review: one accepted privacy race, resolved with a current-consent check and two deterministic regressions.
- Final ReviewGPT round 2: `PASS` with no findings on `c09f14a34dfe0d7d90385111830dbf0b4ca58869`.
- Refreshed product-purpose verdict: the flow is the smallest complete experience; it provides the retained download immediately, states possible incompleteness, preserves recovery, and keeps current consent authoritative for background work. No findings remain.

Completed: 2026-08-11
Completed: 2026-08-11
