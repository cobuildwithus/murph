# Eliminate changelog merge-conflict hotspots

Status: completed
Created: 2026-08-10
Updated: 2026-08-11

## Goal

- Let concurrent feature PRs add public changelog items without editing the same
  registry or inventory-test lines, while preserving the archive, JSON feed,
  permalink, and share-card behavior members already use.

## Success criteria

- A normal changelog update adds one uniquely named entry fragment and does not
  edit the historical changelog registry or an exact hand-maintained inventory.
- Fragment discovery, validation, build-time generation, grouping, and ordering
  are deterministic and fail closed on malformed content or duplicate IDs.
- The existing 2026-08-10 edition renders with the same title, summary, item
  order, IDs, source PRs, and public paths after moving to fragments.
- The PR changelog guard recognizes fragment changes and validates declared PR
  item IDs against the combined registry.
- Agent workflow and changelog-writing guidance point contributors to fragments.
- Focused tests, web typecheck, production build/bundling proof, required reviews,
  and exact-head CI pass.

## Scope

- In scope: fragment schema and build-time loader; ignored generated module;
  deterministic aggregation; migration of the current edition; changelog guard
  and tests; contributor/process documentation.
- Out of scope: rewriting historical editions, redesigning the changelog UI, or
  introducing a database, generator service, dependency, queue, or build daemon.

## Constraints

- Technical constraints: keep the public TypeScript API and item IDs stable; use
  repository JSON files and existing TypeScript tooling; add no dependency; do
  not add runtime filesystem access or repeat source content across route traces.
- Product/process constraints: preserve public copy and ordering for migrated
  content; one feature PR should own one fragment; shared edition metadata is an
  optional curator surface rather than a routine contributor requirement.

## Risks and mitigations

1. Risk: filesystem-backed source either disappears from a Vercel function or
   is copied into unrelated route traces.
   Mitigation: generate one ignored static TypeScript module before development,
   tests, typechecking, and builds; prove the production bundle has no JSON trace.
2. Risk: aggregation changes archive pages, cursors, permalinks, or share cards.
   Mitigation: migrate one edition with explicit order values and retain focused
   behavioral/inventory assertions across the combined registry.
3. Risk: two fragments disagree about shared edition copy or ordering.
   Mitigation: keep edition copy in a separate optional metadata file, reject
   duplicate IDs and invalid path/content pairs, and use filename/ID tie-breaks.

## Tasks

1. Add the fragment schema, validator, deterministic build-time loader, and
   ignored generated-module ownership.
2. Move the current edition into isolated JSON entry fragments plus one edition
   metadata file without changing its public representation.
3. Replace the central exact-inventory workflow with generic fragment and
   combined-registry invariants.
4. Teach the PR changelog guard and contributor guidance about fragment paths.
5. Run focused proof, typecheck/build proof, inspect the candidate diff, then
   commit, push, and open the PR.
6. Run required ReviewGPT stages concurrently with CI, resolve accepted findings,
   and prove exact-head mergeability before completion.

## Decisions

- Keep the historical registry in place as frozen legacy data. A large mechanical
  historical migration would add review risk without reducing future conflicts.
- Use one JSON file per item so independent feature PRs normally touch disjoint
  paths. Use a separate optional edition metadata file so new dates do not require
  a shared file before entries can merge.
- Generate an ignored TypeScript module before web consumers run. A production
  build proved that direct filesystem lookup caused changelog sources and tests
  to be traced into unrelated functions, so runtime reads were rejected.

## Verification

- Focused changelog integration suite: 104 tests passed after every substantive
  remediation and current-base reconciliation.
- PR declaration guard: 13 tests passed, including exceptional historical-owner
  acceptance and false `not applicable` rejection.
- Web typecheck and cold production build passed; 271 emitted app traces contained
  no raw changelog JSON, loader, or generator runtime dependency.
- Temporary one-date and two-date future fragment scenarios passed all eight page
  tests after pagination-sensitive assertions moved to their owning items.
- The current August 10 metadata, all eleven item objects, and deterministic order
  match the reconciled base representation.
- Preliminary specialist review findings were resolved. Final ReviewGPT round 6
  returned `PASS` with no findings after verifying every prior correction.
- All exact-head GitHub Actions and Vercel passed on the mergeable implementation
  head; non-mutating merge-tree proof succeeded against the reconciled base.

## Outcome

- Normal feature work now adds one independently named JSON fragment instead of
  prepending a shared registry or extending a shared latest-page inventory.
- Build-time generation retains the existing runtime API without filesystem reads
  or committed generated output.
- The frozen legacy owner remains available only for declared historical public
  corrections; normal current items stay isolated.
Completed: 2026-08-11
