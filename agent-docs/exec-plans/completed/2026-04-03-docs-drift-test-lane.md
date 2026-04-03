# Remove docs-drift from the default pnpm test lane

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Remove the docs-drift guard from the default `pnpm test` lane so local repo verification is no longer blocked by unrelated dirty `agent-docs/**` worktree changes, while keeping docs drift available as an explicit manual check.

## Success criteria

- `pnpm test` no longer invokes `scripts/check-agent-docs-drift.sh`.
- The standalone `pnpm docs:drift` command still exists.
- Durable verification docs describe `pnpm test` and `pnpm docs:drift` accurately.
- Required verification passes, or any unrelated blockers are called out precisely.

## Scope

- In scope:
- `scripts/workspace-verify.sh`
- Verification docs that describe the default test lane and the explicit docs-drift command
- Out of scope:
- Redesigning the underlying docs-drift tool or repo-tools integration
- Broad verification-policy changes beyond removing this one default invocation

## Constraints

- Technical constraints:
- Keep the change minimal: remove the default invocation, keep the manual command.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Update durable docs in the same change so repo policy matches runtime behavior.

## Risks and mitigations

1. Risk: Durable docs drift becomes easier to miss in ordinary local verification.
   Mitigation: Keep `pnpm docs:drift` available as an explicit manual command and document that shift clearly.
2. Risk: Docs and scripts diverge if only the shell entrypoint changes.
   Mitigation: Update the verification docs and testing map in the same patch.

## Tasks

1. Remove the docs-drift invocation from `run_test()`.
2. Update durable verification docs to describe the new default/manual split.
3. Run required verification and commit the scoped change.

## Decisions

- Prefer removing the default `pnpm test` hook over deleting `scripts/check-agent-docs-drift.sh`, so maintainers can still run the guard intentionally with `pnpm docs:drift`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm docs:drift`
- Expected outcomes:
- `pnpm test` should proceed without the docs-drift preflight.
- `pnpm docs:drift` should remain callable as a separate check.
Completed: 2026-04-03
