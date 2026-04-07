# Replace runtime-state portability allowlist with subsystem descriptor manifests

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Replace the hard-coded operational portability allowlist in `@murphai/runtime-state` with descriptor manifests that are declared per runtime subsystem and aggregated by the taxonomy layer.

## Success criteria

- `packages/runtime-state` resolves operational path portability from aggregated descriptor manifests instead of one long hard-coded predicate.
- Hosted bundle snapshot inclusion and container traversal derive from those descriptors and still fail closed for unclassified operational paths.
- The implementation keeps package ownership simple: no upward dependency from `@murphai/runtime-state` into higher-layer writer packages.
- Durable docs describe the manifest-based contract clearly.
- Required verification passes for the touched surface.

## Scope

- In scope:
  - `packages/runtime-state/**`
  - Durable docs that define runtime-state taxonomy and hosted snapshot inclusion
- Out of scope:
  - Moving descriptor ownership into higher-layer packages
  - Reclassifying unrelated runtime paths outside the current known operational seams
  - Hosted-runner behavior changes beyond snapshot path selection/classification

## Constraints

- Preserve unrelated in-flight edits in the dirty worktree.
- Keep `@murphai/runtime-state` below higher-layer runtime packages; do not introduce package-boundary inversions or cycles.
- Default unknown `.runtime/operations/**` paths to `machine_local`.
- Keep the design simpler than the current central allowlist, not more abstract for its own sake.

## Risks and mitigations

1. Risk: The new manifest model adds abstraction without reducing complexity.
   Mitigation: Use a small descriptor shape, explicit subsystem modules, and deterministic "most specific path wins" resolution.
2. Risk: Portable parent-directory traversal keeps some hard-coded exceptions in snapshot selection.
   Mitigation: Derive portable ancestor containers from the same manifests instead of keeping a separate allowlist.
3. Risk: Existing hosted continuity breaks if a currently portable assistant path is missed.
   Mitigation: Port the current known portable paths into descriptors first and extend focused hosted-bundle tests.

## Tasks

1. Introduce a small runtime-state operational descriptor model and subsystem manifest modules.
2. Aggregate those manifests in the taxonomy layer and replace the hard-coded allowlist predicate.
3. Derive hosted snapshot container traversal from manifest ancestry.
4. Update focused tests and durable docs.
5. Run verification, required review, and commit with the plan artifact.

## Decisions

- Keep descriptor manifests inside `packages/runtime-state` for now because that package already owns the `.runtime` contract and path surfaces.
- Split manifests by subsystem (`assistant`, `inbox`, `device-sync`, `parsers`, generic write receipts) so portability policy is local to each runtime seam without inverting dependencies.
- Resolve operational portability by explicit descriptor match precedence rather than imperative path-specific conditionals.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:packages`
  - Focused runtime-state scenario/test commands if needed while iterating
- Expected outcomes:
  - Typecheck passes unless blocked by a credibly unrelated pre-existing failure.
  - Package tests cover hosted bundle/runtime-state behavior with the new manifest model.
- Outcomes:
  - `pnpm --filter @murphai/runtime-state typecheck` passed.
  - `pnpm --filter @murphai/runtime-state test` passed.
  - `pnpm typecheck` passed.
  - `pnpm test:packages` failed for a credibly unrelated pre-existing reason in `packages/cli/scripts/verify-package-shape.ts`: `package.json must not keep a runtime dependency on @murphai/gateway-core after the hard cut.`
  - Scoped verification was used after that unrelated repo-wide failure because this diff stays narrow to `packages/runtime-state` plus matching docs/tests.
  - Direct scenario check via `pnpm exec tsx --eval '...'` confirmed:
    - `assistantRoot: portable`
    - `cronDirectory: portable`
    - `assistantQuarantine: machine_local`
    - `inboxContainer: true`
    - `diagnosticsContainer: false`
    - `writePayload: portable`
  - Final direct scenario check after the review fix confirmed exact-path fidelity for descendant matches:
    - `cronRunPath: .runtime/operations/assistant/cron/runs/cronrun_1.jsonl`
    - `writePayloadPath: .runtime/operations/op_test/payloads/staged.md`
  - Required `simplify` audit found one medium issue: the portable descriptor for `.runtime/operations/assistant/cron` was missing. The exact-directory descriptor was restored and the focused runtime-state checks were re-run green.
  - Required final review found one medium issue: `describeVaultLocalStateRelativePath()` had started returning descriptor-root paths for subtree/prefix matches. `relativePath` now stays equal to the queried normalized path, targeted regression assertions were added, and the focused runtime-state checks were re-run green.
Completed: 2026-04-07
