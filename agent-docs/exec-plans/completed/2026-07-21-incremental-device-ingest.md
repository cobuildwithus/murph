# Make device ingest evidence incremental

Status: completed
Created: 2026-07-21
Updated: 2026-07-22

## Goal

- Stop recurring Junction/device sync from retaining unchanged rolling-window
  evidence and output links while preserving canonical event identity, replay,
  correction, and provenance invariants.

## Success criteria

- An exact replay persists no duplicate ingest evidence or output links.
- A rolling summary with one new or corrected item adds storage proportional to
  that change instead of another copy of the full historical window.
- Canonical event output, correction, and evidence-link behavior remains
  deterministic and replay-safe.
- Focused real-owner tests, scoped verification, required audits, acceptance,
  and PR review all pass.

## Scope

- In scope:
  - integration-ingest novelty handling for repeated multi-part deliveries
  - canonical output/evidence-link selection needed for incremental retention
  - focused importer/core tests and matching durable storage documentation
- Out of scope:
  - destructive rewrites of existing vault history
  - provider scheduling, credentials, or live account state
  - a second storage owner or migration service

## Constraints

- Keep provider-specific shaping in importers and canonical writes in core.
- Preserve stable ids, immutable history, replay, and correction semantics.
- Use existing novelty and integration-ingest owner boundaries; add no queue,
  database, or generic state manager.
- Keep fixtures synthetic and private provider data out of artifacts and logs.

## Risks and mitigations

1. Risk: dropping evidence needed to replay or explain a corrected event.
   Mitigation: fingerprint stable item versions and retain every novel version,
   with exact-replay and correction regressions through the real core path.
2. Risk: deduping output ids without retaining a genuinely new evidence link.
   Mitigation: distinguish canonical output creation from new link identity and
   test both cases explicitly.
3. Risk: changing non-Junction provider semantics through shared core logic.
   Mitigation: keep the smallest provider-owned representation change and add
   shared-core regressions only where the existing novelty selector owns it.

## Tasks

1. Trace current Junction part construction, core novelty selection, and recent
   changes on remote main; freeze the smallest correct owner-boundary fix.
2. Add replay and one-changed-part coverage through the real core persistence
   path.
3. Implement incremental evidence and output-link retention with no historical
   data mutation.
4. Update durable storage/provider docs where the evidence contract changes.
5. Run focused and acceptance verification plus required audit and ReviewGPT
   gates, then publish the dedicated PR.

## Verification

- `pnpm test:diff <touched paths>` or the truthful owner coverage equivalents
- focused importer/core replay, rolling-window, and correction scenarios
- affected package typechecks
- `pnpm verify:acceptance`
- required `coverage-write` audit and PR ReviewGPT loop

## Progress

- Worktree created from current `origin/main`.
- Existing core novelty selection already proves content and link novelty; the
  persistence seam now consumes that selection instead of re-expanding it to
  the full received batch. Importer representation remains unchanged.
- Exact replay, appended revision, unassociated evidence, shared-owner, and
  bounded-novelty regressions pass through the core persistence owner.
- The required coverage audit found and closed four boundary gaps; the
  follow-up suite passes 167 tests, and `pnpm verify:acceptance` passes.
Completed: 2026-07-22
