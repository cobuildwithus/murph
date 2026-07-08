# Hosted E2E Gate Env Harness Hardening

## Goal

Harden the hosted-local production web harness so `next start` selection, dist preservation, and process residue cleanup share simple, explicit ownership and cannot drift between app env files and harness env.

## Constraints

- Do not commit.
- Keep the fix harness-owned and minimal; do not change `pnpm dev`.
- Do not read or print `.env` file contents.
- Preserve existing hosted-local owner semantics and avoid broad process sweeps.
- Run `pnpm typecheck`, focused harness/helper tests, and `pnpm test:diff` for touched files before handoff.

## Plan

1. Inspect the current production-start decision, dist teardown predicate, BUILD_ID tests, and orphan cleanup patterns.
2. Introduce one explicit harness-owned source of truth for the production web start decision and thread or share it across both call sites.
3. Decide whether BUILD_ID freshness can be hardened simply; add only a narrow check/comment/test or document why not.
4. Add a narrow exact production `next start` residue pattern matching existing owner cleanup semantics.
5. Run focused verification, review the diff for privacy/scope, then close this active plan without committing.

## Verification

- `pnpm typecheck`
- Hosted-local-harness stack tests
- Hosted-local dev-harness helper tests
- `pnpm test:diff` on touched files

## State

Active. Implementation not started.
