# Browser-Vault Compatibility Surface Cleanup

## Goal

Reduce dashboard/source-hash compatibility surface area so active hosted
browser-vault refresh code is named around browser-vault latest-ref publishing,
not dashboard snapshot freshness.

## Scope

- Rename active Cloudflare browser-vault refresh coordinator/scheduling symbols.
- Move active Cloudflare refresh implementation paths out of dashboard-replica naming.
- Rename hosted web browser-vault publish helpers to latest-ref language.
- Remove `expectedSourceStateHash` from active publish request contracts.
- Fence any deploy-skew source-hash handling behind explicitly legacy naming.

## Constraints

- Preserve live behavior: browser-vault refresh writes a replica, then publishes
  only the latest `browserVaultReplicaRef`.
- Preserve deploy-skew tolerance where old callers may still include a source
  hash during the cleanup window.
- Do not revert unrelated dirty browser-vault runner/checkpoint edits.

## Verification

- Run focused hosted-execution, hosted-web, and Cloudflare tests covering the
  renamed surfaces.
- Run typecheck if the broader dirty tree allows it; otherwise report the exact
  unrelated blocker and scoped proof.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
