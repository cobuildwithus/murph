# Extract Junction canonical coverage policy

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Separate accepted-event coverage and cutover admission from raw Junction normalization so each policy has one navigable owner without changing imported facts.

## Success criteria

- Coverage derives only from accepted canonical writer results.
- Fence filtering preserves event-array identity and order and runs before authoritative-set finalization.
- Public importer exports, timestamp acceptance, and cancellation propagation remain unchanged.
- Focused importer, package-boundary, device-sync migration/history tests and both package typechecks pass.

## Scope

- In scope: internal Junction coverage module, existing normalization timestamp primitives, direct internal caller imports, focused proof, and ownership documentation.
- Out of scope: provider diagnostics, resource-by-resource normalization splits, canonical writer changes, schema changes, and hosted behavior.

## Constraints

- Reuse Junction resource and origin policy owners. No new dependencies or public subpaths.
- Keep canonical writes, cancellation, source lifecycle fences, and migration persistence at their current owners.
- Root owns candidate review, Ready, ReviewGPT, exact-head CI, and merge decisions.

## Risks and mitigations

1. Timestamp parsing changes while sharing leaves.
   Mitigation: move the existing permissive parser unchanged; do not substitute strict toIso.
2. Fence extraction disconnects the returned array or changes authoritative sets.
   Mitigation: pass the original events array and retain in-place splice at the same normalization stage.
3. Accepted coverage is accidentally derived from proposed facts.
   Mitigation: keep the caller after the writer result and retain canonical-import integration proof.

## Tasks

1. Confirm current callers and owners against the assigned base.
2. Move coverage types and algorithms into junction-canonical-coverage.ts and share unchanged timestamp leaves through shared-normalization.ts.
3. Preserve public exports and update direct internal callers plus focused ownership documentation.
4. Run focused tests, typechecks, complexity diff, privacy checks, and self-review.
5. Close this plan with a scoped commit, push, and open a draft PR for parent completion.

## Decisions

- Baseline: b2a559812972d70644cffb2bf43923fc9211047d.
- Internal extraction only; no product or persisted-contract change and no changelog item.
- Existing coverage tests exercise provider-local day closure, accepted timestamps, migration fences, and canonical-import composition.

## Verification

- Passed: importer Junction and package-boundary suites, 263 tests, with maxWorkers=2.
- Passed: importer cancellation selection, 2 tests, with maxWorkers=1.
- Passed: device-sync migration/history/cancellation selection, 10 tests, with maxWorkers=1.
- Passed: `pnpm --filter @murphai/importers typecheck` and `pnpm --filter @murphai/device-syncd typecheck`.
- Passed: `pnpm --filter @murphai/importers build`, including emitted public coverage reexports.
- Passed: `pnpm complexity:diff --base b2a559812972d70644cffb2bf43923fc9211047d`; new coverage maximum 16 and no added debt. Eleven existing normalizer hotspots remain unchanged and outside this extraction.
- Passed: moved coverage body and timestamp leaves match the base text except for the narrower fence event-array argument; cancellation bridge changes only its import.
- Passed: parent initial review, `git diff --check`, scoped-path review, and privacy review.
- Exact-head CI and final ReviewGPT remain with the parent completion owner after the draft handoff.

## Outcome

Coverage types, derivation, provider-day closure, and fence admission now live in one internal module. Public exports remain compatible; source/resource primitives remain with their existing owners. The original event array is filtered in place before authoritative-set finalization, and only accepted canonical writer results produce coverage. No product, persisted-schema, cancellation, or provider-request behavior changed.
Completed: 2026-09-10
