# PR 611 current-main reconciliation

Status: active
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Reconcile PR 611 with current `main` without changing its group-join confirmation behavior.

## Success criteria

- The branch contains the current `main` and the prior pushed PR head.
- PR 542 remains present and PR 573 remains excluded.
- The only manual conflict keeps both independent documentation-index entries.
- Focused group-join verification and exact-head CI pass on the pushed result.

## Scope

- In scope: ordinary merge of current `main`, the one documentation-index conflict, focused verification, push, and exact-head CI monitoring.
- Out of scope: unrelated hosted-runtime harness changes, PR 573, duplicate ReviewGPT runs, and merging the PR into `main`.

## Constraints

- Preserve the existing PR-specific code, tests, config, and durable documentation.
- Do not patch the unrelated runtime-checkpoint container restart/status-poll race without new causal proof.
- Do not rerun ReviewGPT when the merge changes base history only and preserves the PR-specific patch.

## Tasks

1. Merge current `origin/main` through ordinary Git history.
2. Resolve only the documentation-index adjacency while retaining both entries.
3. Prove PR 542 ancestry, PR 573 exclusion, and preservation of the prior PR head.
4. Run focused group-join verification, close this plan, push, and monitor exact-head CI.

## Verification

- Focused hosted group-join tests and rollout tests.
- Web TypeScript typecheck or the routed diff verification selected by the repository tooling.
- Exact-head GitHub checks and Vercel status.
