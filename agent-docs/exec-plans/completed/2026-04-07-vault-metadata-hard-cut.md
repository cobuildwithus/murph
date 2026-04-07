# 2026-04-07 Vault Metadata Hard Cut

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Hard-cut `vault.json` down to long-term instance-owned facts only.
- Remove persisted layout/id-prefix/shard metadata and the `vault paths` command surface while the repo is still greenfield.

## Success criteria

- Canonical vault metadata contains only `formatVersion`, `vaultId`, `title`, `timezone`, and `createdAt`.
- `formatVersion` remains the single compatibility knob for vault metadata evolution.
- No compatibility hydration or upgrade path remains for the pre-live metadata shape.
- Runtime layout/id/shard behavior is code-owned only.
- CLI/query/docs/tests no longer depend on persisted `idPolicy`, `paths`, `shards`, or vault-level `schemaVersion`.

## Scope

- In scope:
- `packages/contracts/**`
- `packages/core/**`
- `packages/query/**`
- `packages/assistant-engine/**`
- `packages/cli/**`
- contract/architecture docs and focused tests
- Out of scope:
- unrelated compatibility cleanup outside the vault metadata lane
- broader vault storage redesign beyond this metadata hard cut

## Constraints

- This is a true hard break for pre-live/dev vaults; do not preserve compatibility.
- Keep `formatVersion` at `1` for the new minimal shape.
- Remove `vault paths` rather than rehoming it.
- Preserve unrelated dirty-tree edits.

## Risks and mitigations

1. Risk:
   Contract/runtime/docs drift leaves some commands or tests on the old shape.
   Mitigation: change contracts, core builders, CLI command manifest, tests, and docs in one pass.
2. Risk:
   Query or CLI read surfaces still treat metadata as self-describing layout state.
   Mitigation: remove the `vault paths` surface and trim `vault show` to instance facts only.
3. Risk:
   Old compatibility helpers survive and reintroduce migration-era complexity.
   Mitigation: delete compatibility hydration/tests and keep validation strict on the new shape.

## Tasks

1. Remove persisted `schemaVersion`, `idPolicy`, `paths`, and `shards` from the vault metadata contract and builder.
2. Delete compatibility/hydration logic and any CLI/query surfaces that expose the removed fields.
3. Update docs and focused tests to the minimal metadata model.
4. Run required verification plus direct proof, then final audit review and scoped commit.

## Verification

- Required:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- Direct proof:
- built CLI or focused test evidence showing `vault show` still works and `vault paths` is gone
Completed: 2026-04-07
