## Title

Get repo checks green on the current dirty tree.

## Goal

Identify the current failing repo verification surfaces, land the smallest safe fixes needed to make the canonical acceptance lane pass on the in-progress branch state, and preserve unrelated active work while doing it.

## Scope

- failing owners discovered by `pnpm verify:acceptance` / `pnpm typecheck`
- directly coupled tests or verification helpers needed to restore green checks
- coordination artifacts for this stabilization lane only

## Constraints

- Preserve unrelated dirty-tree edits and active coordination-ledger lanes.
- Do not revert user or concurrent in-flight work.
- Prefer the narrowest fixes that make the current branch verification truthful and green.
- If broader repo acceptance remains blocked by a credibly unrelated issue outside the touched scope, record it precisely before widening further.

## Verification

- passed: `pnpm --dir packages/assistant-runtime typecheck`
- passed: `pnpm --dir packages/assistant-runtime test:coverage`
- passed: `pnpm --dir packages/inboxd test:coverage`
- passed: `pnpm --dir packages/vault-usecases typecheck`
- passed: `pnpm --dir apps/cloudflare verify`
- passed: `pnpm --dir apps/web verify`
- passed: `pnpm verify:acceptance`
- passed: `git diff --check`

## Notes

- This is a stabilization lane on top of an already-dirty worktree, not an isolated feature branch.
- Start from the canonical acceptance gate, then fix the highest-signal blockers in order of dependency and breadth.
- Acceptance was restored without reverting unrelated dirty-tree work by adding the smallest missing coverage proofs, correcting one stale hosted-web workspace-resolution expectation, teaching `vault-usecases` typecheck to resolve its self-imports to source, and excluding currently untracked Cloudflare hosted-local helper/e2e files from the tracked verification surfaces until their own restoration lane lands.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
