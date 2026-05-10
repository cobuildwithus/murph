# Remove first legacy cleanup tranche

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

- Remove the first confirmed tranche of legacy cleanup targets: the orphaned runtime-state crypto module, source-only private barrels, stale hosted-assistant-input migration docs, and stale pnpm minimum-release-age exceptions.

## Success criteria

- The targeted legacy files/config entries are gone or proven intentionally retained.
- No public package entrypoints are removed.
- No canonical durable docs reference deleted stale docs.
- Focused package checks, typecheck coverage, supply-chain verification, and completion audits pass or have a documented unrelated blocker.
- A scoped finish-task commit lands the cleanup without including unrelated dirty work.

## Scope

- In scope:
  - `packages/runtime-state/src/legacy-hosted-user-keys.ts` and its direct stale test.
  - Source-only private barrels in `packages/assistant-cli` and `packages/operator-config/src/index.ts`.
  - Direct config/boundary references that would otherwise point at deleted private barrels.
  - `docs/hosted-assistant-input-*.md` stale migration/plan docs and direct references to them.
  - Stale Next `16.2.2` `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml`.
- Out of scope:
  - Stripe meter drain removal; discuss after this tranche lands.
  - Hosted runner / Cloudflare active worktree changes.
  - Public package export redesigns or compatibility shims.

## Constraints

- Technical constraints:
  - Preserve current greenfield hosted/runtime architecture and current browser-session keying.
  - Do not remove declared package exports or sibling package public entrypoints.
  - Keep pnpm supply-chain exceptions narrow and current.
- Product/process constraints:
  - Preserve unrelated dirty work and active plan rows.
  - Use required repo verification and audits before handoff.

## Risks and mitigations

1. Risk: A source-only barrel is still imported by an internal test or development tool.
   Mitigation: Grep before and after deletion; update local imports only when the target is not a public entrypoint.
2. Risk: Deleted migration docs contain live invariants not covered elsewhere.
   Mitigation: Confirm direct references and canonical docs coverage before deletion; do not touch active exec plans.
3. Risk: Supply-chain config removal invalidates install verification.
   Mitigation: Run pnpm dependency/config verification after editing.

## Tasks

1. Confirm each target is unused or stale.
2. Remove the targeted legacy files/config entries.
3. Run focused verification and required audits.
4. Finish with a scoped cleanup commit.

## Decisions

- Treat Stripe meter drain as the next discussion item, not part of this cleanup tranche.

## Verification

- Commands to run:
  - Targeted package tests/typechecks for touched packages.
  - `pnpm typecheck` or scoped typechecks if unrelated active work blocks the repo check.
  - `pnpm test:diff` for changed paths where applicable.
  - pnpm dependency/config verification for the workspace config change.
  - Required completion audits.
- Expected outcomes:
  - Checks pass, or any failures are tied to pre-existing unrelated dirty work with evidence.
Completed: 2026-05-10
