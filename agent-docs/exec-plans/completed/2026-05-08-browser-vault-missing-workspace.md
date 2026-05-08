# Browser Vault Missing Workspace Publish

## Goal

Treat browser-vault replica publish attempts against a deleted/missing hosted workspace as stale work instead of an operational server failure.

## Scope

- Allow the shared browser-vault publish response to represent `workspace: null`.
- Return a non-urgent stale/missing response from the web publish route instead of throwing.
- Add focused parser/route coverage for the missing-workspace case.

## Constraints

- Keep browser-vault replica publication derived-only; do not move it into the foreground checkpoint path.
- Preserve existing conflict and stale-source behavior.
- Do not expose secrets, account identifiers, local paths, or raw request bodies in tests or docs.

## Verification

- Focused hosted-execution parser tests.
- Focused hosted-web internal route tests.
- Diff-scoped verification if practical in the dirty worktree.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
