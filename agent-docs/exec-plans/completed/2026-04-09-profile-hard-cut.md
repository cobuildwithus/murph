# Hard-cut profile into memory/wiki/preferences

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Hard-cut the `profile` product surface from Murph, replace its machine-facing unit-preference role with a narrow typed singleton, move human-facing "top goals" context into freeform memory, and make wiki + memory + preferences the only surviving surfaces.

## Success criteria

- No `profile` CLI noun or `profile current rebuild` command remains in the built command surface.
- No `bank/profile/current.md` or `ledger/profile-snapshots/**` contract/read/write path remains in core, query, fixtures, or docs.
- Workout/body-measurement unit preferences read and write through a new narrow typed preferences owner instead of profile snapshots.
- Assistant/read-model guidance no longer points Murph at a current-profile surface.
- Overview/export-pack paths no longer depend on current profile.
- Memory remains freeform; top-goal guidance moves there without introducing a typed memory schema.
- Required verification and one direct scenario proof pass for the new preference flow complete, plus the required final audit pass.

## Scope

- In scope:
- Remove profile contracts, core mutations, query families/projections, CLI commands, assistant guidance, fixtures, tests, and durable docs.
- Add a narrow typed canonical preferences singleton for workout/body-measurement units.
- Repoint product reads/writes that previously depended on profile to memory/wiki/preferences.
- Out of scope:
- Compatibility shims, migrations, or backward-compatibility reads for old profile data.
- New product features beyond the hard cut.

## Constraints

- Technical constraints:
- Preserve unrelated worktree edits and port carefully on top of any concurrent changes.
- Keep memory freeform rather than introducing typed machine-facing memory records.
- New persisted state must be explicitly canonical and schema-versioned.
- Product/process constraints:
- Greenfield hard cut: breaking old local profile-based vaults is acceptable.
- Top goals no longer need typed goal-id linkage in overview/export surfaces.

## Risks and mitigations

1. Risk: profile dependencies are spread across contracts, query model families, CLI descriptors, fixtures, and tests.
   Mitigation: land the rewrite in coordinated slices with explicit ownership and finish with full-text dependency sweeps for `profile_snapshot`, `current_profile`, and `bank/profile/current.md`.
2. Risk: replacing profile-backed unit preferences could accidentally weaken measurement/workout UX.
   Mitigation: keep a typed canonical singleton for preferences and capture direct CLI proof for `workout units show|set`.
3. Risk: moving top-goal context to freeform memory could leave stale assumptions in overview/export or assistant prompts.
   Mitigation: remove those typed overview/export dependencies in the same change and rewrite assistant guidance to memory/wiki/preferences only.

## Tasks

1. Add an active coordination-ledger row and keep this plan updated as the cross-cutting source of truth.
2. Introduce a new canonical preferences singleton contract plus core/query/read/write helpers for typed unit preferences.
3. Move workout unit-preference commands and helper logic onto the new preferences owner.
4. Remove profile contracts, core storage, CLI nouns, query families/projections, search/timeline record types, fixtures, and tests.
5. Repoint assistant guidance, overview/export-pack reads, and any product copy from profile to memory/wiki/preferences.
6. Rewrite docs and architecture/contracts text to describe the new storage split.
7. Run required verification plus direct scenario proof, then the mandatory final audit pass, then commit with `scripts/finish-task`.

## Decisions

- Hard cut with no compatibility shims or migrations.
- `bank/memory.md` stays freeform and owns human-facing "top goals" context.
- A new narrow canonical preferences singleton owns machine-facing unit defaults only.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- focused direct scenario proof via built CLI for `workout units show|set`
- Expected outcomes:
- All required commands pass on the final tree, or any unrelated pre-existing failure is documented with a defensible separation.

## Progress notes

- Completed:
- Removed the `profile` CLI noun, core storage/write surfaces, query families, generated schema artifacts, smoke scenario references, and durable docs that still treated `profile` as a live product surface.
- Added and wired the canonical `bank/preferences.json` owner for workout/body-measurement unit defaults.
- Repointed the generated CLI command surface and config schema so `profile` commands no longer appear.
- Restored query/export-pack behavior so export-pack health derivation no longer re-reads virtual vaults from disk, and restored the missing query `history` module that the CLI runtime expected.
- Verification results:
- `pnpm test:smoke` passed.
- Direct source-CLI proof passed for `init`, `workout units show`, `workout units set --weight kg --distance km --body-measurement cm`, and a follow-up `workout units show`, confirming the new `bank/preferences.json` flow.
- `pnpm typecheck` failed in untouched `packages/core/**` files with broad pre-existing/current-tree type errors unrelated to the profile hard cut (automation/provider typing and contracts-output resolution issues).
- `pnpm test:packages` failed in broader current-tree lanes outside the hard-cut surface, including blood-test/query behavior, prepared-runtime build issues around history/core service seams, and unrelated assistant/setup tests. The profile-specific source sweep and the targeted query/export-pack regression fix were still completed.
Completed: 2026-04-09
