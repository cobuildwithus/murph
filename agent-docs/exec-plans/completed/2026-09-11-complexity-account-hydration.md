# Simplify hosted account hydration

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Reduce the hosted hydration transaction's branching while preserving hosted-first
identity, fail-closed legacy consolidation, independent connection/token revision
fences, token clearing, setup fields, and job retirement/wake ordering.

## Evidence and owner

The existing store hydration callback has complexity 127 and file debt 115.
The callback mixes identity resolution, revision acceptance, repeated field
selection, and three-table persistence. Metadata sanitizers and cleared
credential projection also duplicate existing logic. The SQLite store remains
the sole local owner; no schema or persisted-state contract changes.

## Implementation

- Keep identity lookup/consolidation and all writes inside one immediate transaction.
- Name identity and observation decisions; select the accepted connection once,
  retaining the existing null fallback behavior for nullable connection fields.
- Reuse identical metadata sanitization and existing credential projection.
- Preserve SQL statements, write order, job effects, and public APIs.

## Risk and proof

Stale snapshots must not overwrite live revisions or credentials; nullable legacy
fields retain their established fallback. Public store tests cover identities,
privacy forks, stale/replayed versions, and reconnect effects. Add focused null
fallback/accepted clearing regression coverage and prove it against the base.
Run the full store suite, service hydration scenario, package typecheck, and
complexity guard with bounded workers. Parent owns candidate review and final
ReviewGPT/CI. Internal refactor only; no member-visible changelog.

## Progress

- Investigation and owner documentation complete.
- Implementation complete: shared metadata sanitization and credential projection,
  explicit identity/revision phases, and one connection selection.
- Base regression proof: both new stale/replayed field tests pass against the
  unmodified source. Candidate proof: 62 store/field tests and one focused
  service hydration test pass with one worker per command.
- `MURPH_TSC_PACKAGE_MODE=single-threaded pnpm --dir packages/device-syncd typecheck` passes.
- `pnpm complexity:diff --base HEAD -- packages/device-syncd/src/store/hosted-account-hydration.ts`
  passes: file debt 115 to 29, maximum 127 to 36, transaction callback 127 to 21.
- Remaining hotspots keep cohesive identity consolidation (36), unchanged token
  acceptance policy (28), observed revision projection (23), replay comparison
  (21), and transactional persistence/job effects (21). Further splitting solely
  for the threshold would obscure those decisions.
- Candidate diff and privacy checked; no contract, schema, or deployment skew change.
  Parent completion review, ReviewGPT, and exact-head CI remain separately owned.
Completed: 2026-09-11
