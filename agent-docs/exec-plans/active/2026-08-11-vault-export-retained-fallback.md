# Restore Retained Vault Export

Status: active
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

