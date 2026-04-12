# Greenfield version cutover

Status: completed
Created: 2026-04-12
Updated: 2026-04-12

## Goal

- Hard-cut greenfield compatibility and multi-version seams so the repo persists and accepts only current `v1` contracts where a durable version seam still exists.

## Success criteria

- Assistant session/runtime persistence no longer accepts legacy session schemas and writes only `murph.assistant-session.v1`.
- Current persisted owner schemas that still use `v2+` names are renumbered to `v1` where the repo no longer needs historical compatibility.
- Legacy read-normalization paths for greenfield-only local data are removed instead of silently rewriting old shapes at read time.
- Tests and durable docs reflect a single-version greenfield posture with no leftover dual-parse expectations in the touched owners.
- Required verification for the touched owners passes, or any unrelated blocker is called out concretely.

## Scope

- In scope:
- Assistant session/runtime contracts in `operator-config`, `assistant-engine`, `assistant-cli`, `assistantd`, `cli`, and `setup-cli`.
- Current non-`v1` persisted schema identifiers in touched owner packages when they are part of live runtime storage or durable envelopes.
- Legacy normalization or compatibility readers that still accept superseded local data in the touched owners.
- Out of scope:
- Historical release-note prose and changelog references.
- Runtime/database migration frameworks that still need a version seam for SQLite mechanics, unless a touched owner is carrying an unnecessary multi-version reader.

## Constraints

- Preserve unrelated dirty worktree edits, especially the active root dependency lane and `packages/messaging-ingress/**`.
- Keep the cutover bounded to durable schema/version seams and greenfield legacy readers, not opportunistic unrelated refactors.
- Update durable docs only if the current architecture text becomes inaccurate after the cutover.

## Risks and mitigations

1. Risk: Renumbering or hard-cutting persisted schemas can break runtime reads in adjacent packages.
   Mitigation: inventory all source-level schema/version seams first, then update owners and their downstream tests together.
2. Risk: Some version numbers are current-format identifiers rather than active compatibility lanes.
   Mitigation: separate true multi-version readers from single-format current schemas before editing, and avoid touching migration scaffolding that is still the only truthful owner seam.
3. Risk: Broad search-and-replace can collide with concurrent work in shared assistant files.
   Mitigation: keep the write set explicit, review current file state before editing, and commit only the exact touched paths.

## Tasks

1. Inventory source-level non-`v1` schema/version seams and true legacy compatibility readers.
2. Collapse greenfield compatibility readers and renumber touched durable contracts to `v1`.
3. Update tests and any necessary durable docs to match the single-version posture.
4. Run truthful owner verification and capture direct proof for the assistant session cutover.
5. Finish with a scoped commit.

## Outcome

- Durable assistant session persistence now hard-cuts to `murph.assistant-session.v1`, and current runtime lock compatibility fallbacks were removed instead of preserved for migration.
- Greenfield durable envelopes that still carried `v2+` identifiers in the touched owners were renumbered to `v1`, including hosted bundle/user-key, hosted email/share/usage crypto envelopes, gateway opaque ids, raw import manifests, and setup/bootstrap contracts.
- Legacy read-normalization for preferences and setup inbox config was removed; missing or superseded shapes now fail closed instead of being silently upgraded in-memory.
- Final acceptance verification passed on `pnpm verify:acceptance` after aligning CLI, runtime-state, assistant-engine, and Cloudflare tests to the single-version contract.
Completed: 2026-04-12
