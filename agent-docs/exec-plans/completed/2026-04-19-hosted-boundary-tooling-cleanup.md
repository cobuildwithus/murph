# Remove stale hosted boundary hints from repo tooling and hosted storage scopes

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Finish the remaining greenfield cleanup around hosted-cutover tooling/runtime-state residue:
- repo boundary tooling should stop pointing at deleted hosted-execution outbox/dispatch surfaces
- hosted storage scope enums should stop carrying dead ownership crumbs

## Success criteria

- `scripts/verify-workspace-boundaries.mjs` no longer tells callers to use deleted `@murphai/hosted-execution/outbox-payload` or `@murphai/hosted-execution/dispatch-ref` surfaces.
- `packages/runtime-state/src/hosted-storage.ts` removes the dead hosted storage scopes that no longer have live callers.
- Focused tests stay green for any runtime-state scope changes.

## Scope

- `scripts/verify-workspace-boundaries.mjs`
- `packages/runtime-state/src/hosted-storage.ts`
- focused tests/docs that directly validate those surfaces

## Constraints

- Keep this lane scoped to tooling and runtime-state metadata only.
- Do not widen into broader hosted wake semantics, app code, or deployment docs.
- Treat the completed hosted-execution surface trim as the current source of truth for deleted subpaths.

## Risks and mitigations

1. Risk: a supposedly dead hosted storage scope still has an obscure live caller.
   Mitigation: search the repo before pruning and keep the test scope focused on the enum/parser seam.
2. Risk: boundary-tooling guidance drifts toward another stale replacement hint.
   Mitigation: delete the dead guidance instead of inventing another focused subpath unless a live owner surface is explicit in the codebase.

## Tasks

1. Remove the stale hosted-execution outbox/dispatch guidance from `scripts/verify-workspace-boundaries.mjs`.
2. Search for live `HostedStorageScope` usage and prune dead enum values from `packages/runtime-state/src/hosted-storage.ts`.
3. Update focused tests if the runtime-state scope parser needs narrower coverage.

## Decisions

- The cleanup should reflect the already-landed hosted-execution surface trim, not preserve compatibility hints for deleted subpaths.
- Dead storage scopes should be deleted rather than left as inactive legacy values in greenfield code.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff scripts/verify-workspace-boundaries.mjs packages/runtime-state/src/hosted-storage.ts packages/runtime-state/test/hosted-storage.test.ts`
- expected outcome: focused tooling/runtime-state checks stay green without reintroducing hosted dispatch/outbox terminology
Completed: 2026-04-19
