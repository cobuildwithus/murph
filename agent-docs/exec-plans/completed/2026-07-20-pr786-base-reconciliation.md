# PR 786 Base Reconciliation

## Goal

Reconcile PR 786 with current `origin/main` after the catalog simplification
push exposed one generated CLI skill-hash conflict.

Success criteria:

- the merge preserves both current-main changes and the PR-specific product-test
  patch;
- the only manual resolution is the generated Vault CLI skill hash, regenerated
  from the merged command tree through its canonical generator;
- the branch is mergeable and CI runs on the reconciled head; and
- ReviewGPT round 6 is not started without explicit approval.

## Constraints

- Do not hand-edit or choose either side of the generated hash.
- Do not change product-test behavior while reconciling the base.
- Preserve the ignored local product-test temp artifacts.
- Do not merge the PR itself.

## Working Set

- `packages/cli/src/vault-cli-skill-hash.generated.ts`
- merge metadata and this plan/ledger entry

## Verification Plan

- Confirm the generated hash is the only unmerged path.
- Run the canonical generator and focused skill-hash test.
- Run diff/privacy checks, commit the merge, close this plan, push, and require
  PR CI on the new head.

## Outcome Evidence

- `git merge-tree --write-tree` and the real merge both identified exactly one
  conflict: the generated Vault CLI skill hash.
- The generator initially could not build across conflict markers, then needed
  the merged dependency runtime rebuilt. A temporary all-zero valid sentinel
  enabled that build only; the canonical generator replaced it with the merged
  command-tree hash.
- `pnpm --dir packages/cli verify:prepared-runtime` and
  `pnpm --dir packages/cli gen:config-schema` passed on the merged tree.
- The focused generated-hash test passed 2 tests, and no unmerged path remains.

Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
