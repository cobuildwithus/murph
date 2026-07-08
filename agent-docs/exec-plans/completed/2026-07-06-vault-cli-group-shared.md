# vault-cli group shared — the group container's reader for consented member data

Status: completed
Created: 2026-07-06

Utmost priority: clean, simple, long term maintainable and composable
architecture with minimal complexity.

## Goal

Close the open loop in VaultShare. Every projection kind already lands in a
group container's own vault at `derived/vault-share/projections.json`
(written idempotently by `importHostedVaultShareDeliveryWake`), but nothing
reads it, so the group assistant cannot run challenges over consented member
data. Add the reader: a deterministic, read-only `vault-cli group shared`
command that turns the landed file into a compact, member-named, challenge
ready view the group assistant pulls on demand, and point the group-chat skill
at it.

## Design

1. **Own the store contract in one place.** Today the store file shape +
   parser live privately inside
   `packages/assistant-runtime/src/hosted-runtime/vault-share-import.ts`. The
   CLI cannot reach into a sibling package's `src/`, and the schema must not be
   duplicated. Extract the pure, fs-free pieces into
   `@murphai/hosted-execution/vault-share` (already the owner of every other
   vault-share contract, already a dependency of both `assistant-runtime` and
   `cli`):
   - the store types + schema const `murph.shared-vault-projections.v1`
   - `parseSharedVaultShareProjectionStore(json): SharedVaultShareProjectionsFile | null`
   - the relative store path `derived/vault-share/projections.json`
   - a pure pivot `flattenSharedVaultShareProjectionStore(store): SharedGroupMemberView[]`
     (kind-major store -> member-major view, joining each grantor's
     `profile-name.v0` displayName onto their health records)

   Then `vault-share-import.ts` imports those instead of defining them
   locally, keeping only its fs read + upsert + repair + write. One owner, two
   consumers (writer + reader), no new dependency edges, no cycle.

2. **`vault-cli group shared` command** (mirrors the `wearables` command
   registration). Strictly read-only: never mutates or repairs the store (the
   importer stays the sole writer).
   - default: compact human table grouped by member, name-joined, most-recent
     value + count per kind. Cheap on tokens for mid-challenge reads.
   - `--json`: stable `SharedGroupMemberView[]` for exact leaderboard math.
   - `--kind <k>` (repeatable, validated against the registry): single-metric
     leaderboard.
   - `--member <id>` (repeatable): drill into specific members.
   - `--days <n>` (1-7, default 7): trailing-day window.

3. **Formatting per data shape.** 13 daily-metric kinds
   (`{date, metricKey, unit, value}`) share one generic row path; sleep-times,
   workout-days, and heart-rate-zones-days get small dedicated formatters;
   profile-name is consumed as the name join, never printed as a metric row.

4. **Skill wording.** Add usage to the group-chat skill's "Shared challenge
   data" section: run `vault-cli group shared`, use `--kind` for a leaderboard
   and `--json` for exact numbers, and never invent figures when it is empty.

## Constraints / invariants

- Read-only reader: no writes, no repair, no delete of the store. The importer
  owns repair on its next write (single writer preserved).
- Store schema string stays `murph.shared-vault-projections.v1`; already-landed
  files must remain parseable (no format change).
- No new persisted state; no web/runtime deploy-boundary change (the extracted
  code is pure and ships in the same runner bundle as writer + reader).
- Empty file / no records / corrupt file all resolve to a clean exit-0 message,
  never a crash in a group turn.
- Name absent (profile-name not landed yet) -> show member id, note names
  arrive after that member's runtime wakes.

## Success criteria

- `vault-cli group shared` on a populated container prints a member-named
  table; `--kind steps-days.v0` prints a single-metric leaderboard; `--json`
  emits the stable structured view; empty/corrupt states print the documented
  message and exit 0.
- `importHostedVaultShareDeliveryWake` / `applyHostedVaultShareRevokeWake`
  behavior is unchanged (same store file, same idempotency).
- The group-chat skill documents the command.

## Verification

- `pnpm typecheck`
- `pnpm test:diff <touched paths>` across hosted-execution, assistant-runtime,
  cli, assistant-engine owners (parse/flatten unit + CLI command fixture tests
  covering default / --json / --kind / empty / corrupt, plus unchanged importer
  behavior).
- Direct run of the built CLI command against a fixture vault.

## Files (planned)

- `packages/hosted-execution/src/vault-share*.ts` (+ `/vault-share` export)
- `packages/assistant-runtime/src/hosted-runtime/vault-share-import.ts`
- `packages/cli/src/commands/group.ts`
- `packages/cli/src/vault-cli-command-routing.ts`,
  `packages/cli/src/vault-cli-command-manifest.ts`
- `packages/assistant-engine/skills/group-chat/SKILL.md`
- matching tests in each owner
Updated: 2026-07-06
Completed: 2026-07-06
