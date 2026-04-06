# Implement vault upgrade system on the post-split repo

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Land a first-class canonical `vault upgrade` flow with explicit `formatVersion`, ordered migrations, strict current-format gating for normal canonical operations, and operator-facing validation/upgrade planning on the current post-`assistant-core` split repo shape.

## Success criteria

- Core vault metadata exposes an explicit current `formatVersion`.
- Normal canonical operations fail closed on outdated vault formats until `vault upgrade` runs.
- `vault validate` can classify upgrade requirements without silently mutating canonical metadata.
- `vault repair` remains scaffold-only and does not become a hidden legacy migration path.
- `vault upgrade` is wired through core, CLI services, CLI contracts/schemas, docs, and focused tests on the current owner packages.
- The final implementation uses current owners (`core`, `vault-inbox`, `assistant-engine`, `operator-config`, `cli`) rather than reviving `assistant-core`.

## Scope

- In scope:
- core metadata/versioning, validation, repair, and ordered upgrade flow
- CLI command wiring, manifests, config schema, result contracts, and focused tests
- durable docs updates for the new canonical upgrade seam
- porting the supplied patch intent onto the current repo layout
- Out of scope:
- unrelated thread recommendations beyond the vault upgrade lane
- broad storage redesign beyond what the upgrade system requires

## Constraints

- Keep canonical writes owned by `packages/core`.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve the post-split owner package boundaries; do not reintroduce `assistant-core`.
- Rebuildable `.runtime/projections/**` stores must not become canonical migration state.
- Keep `vault repair` scaffold-only.

## Risks and mitigations

1. Risk:
   The patch targets pre-split paths and could reintroduce old owner drift if applied mechanically.
   Mitigation: map each hunk to current owners first, then port only the intended behavior.
2. Risk:
   Current-format gating could break existing init/repair/update paths unexpectedly.
   Mitigation: add focused core and CLI tests for legacy vault rejection, dry-run planning, and successful upgrade/apply flow.
3. Risk:
   Legacy metadata compatibility could silently mutate old vaults through validate/repair.
   Mitigation: keep compatibility reads classification-only and require explicit `vault upgrade` for canonical writes.

## Tasks

1. Map the supplied patch onto current owners and inspect the existing core/CLI vault flows.
2. Add/port core metadata format-version contracts, validation helpers, and ordered upgrade registry/runner.
3. Wire the upgrade flow through current service types/integrated services/CLI contracts and commands.
4. Port or add focused tests for legacy-format gating, dry-run/apply upgrade behavior, and CLI command coverage.
5. Update architecture/docs for the canonical upgrade seam and current command semantics.
6. Run required verification, audit passes, and commit with `scripts/finish-task`.

## Verification

- Required:
- `pnpm typecheck`
- `pnpm test:coverage`
- Focused direct proof:
- run `vault-cli vault upgrade --dry-run` or equivalent focused command/test proof against a legacy-format fixture if practical
Completed: 2026-04-06
