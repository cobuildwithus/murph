# Remove Browser-Vault Member-ID Compatibility

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

Remove the browser-vault client's temporary tolerance for successful `empty`
and `not_modified` responses that omit member identity. Success means those
responses fail closed unless they carry a non-empty `memberId`, while ready
replicas continue to bind identity through encrypted AAD and local unauthorized
results continue to use the intentional synthetic `memberId: null` state.

## Scope

- Tighten the successful browser-vault session response parser.
- Replace legacy-acceptance tests with strict missing-proof coverage.
- Document the permanent hosted-web rollback floor created by the hard cut.

## Constraints

- Preserve the existing cross-member identity-change behavior.
- Preserve ready-replica identity from `replicaAad.userId`; do not add a
  redundant top-level member field to ready responses.
- Preserve the local 401/403 synthetic empty result with `memberId: null`.
- Do not change the server producer or add compatibility machinery.
- Preserve unrelated working-tree and coordination-ledger work.

## Tasks

1. Make successful `empty` and `not_modified` session responses require a
   non-empty `memberId` and delete the legacy parser helper.
2. Add focused strict-parser regression coverage while retaining unauthorized
   synthetic-null and valid identity proofs.
3. Record the #586 hosted-web rollback floor in the app owner documentation.
4. Run focused tests, stale-language searches, diff hygiene, and the truthful
   diff-aware hosted-web verification lane.

## Verification

- Focused browser-vault loader Vitest passed: 10/10 tests.
- Stale helper, legacy-language, privacy, and secret scans passed.
- `git diff --check` passed.
- `pnpm test:diff` passed TypeScript, dev smoke, lint with zero errors, 430
  test files and 5,216 tests, and the production Web build.
- Required coverage-write audit passed with no edits or actionable proof gaps.
- Parent final review confirmed successful wire responses fail closed while
  ready AAD identity and the synthetic unauthorized null state remain intact.
Completed: 2026-07-15
