# Simplify workout snapshot reconciliation through a Pro-authored patch

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and owner

Make workout CSV reconciliation easier to review without changing saved workouts, replay outcomes, correction authority, or persistence ordering. The user requires GPT-6 Pro to implement the source and tests; the local owner prepares the scope and verifies the returned patch. The parent owns sending, downloading, candidate review, and final PR gates.

## Evidence and bounded design

The supplied complexity inventory reports file debt 106 and maximum 61 at base `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`. `resolvePriorSnapshotMatches` combines prior-plan admission, attachment alignment, cross-snapshot identity selection, unit interpretation, and source-content comparison. Weight/distance authority checks repeat within that resolver and in exact-evidence reconciliation.

Pro separated coherent reconciliation stages and removed repeated unit-comparison policy with small private helpers. Preserve the existing first-pass alignment followed by second-pass comparison. Keep source-row parsing in importers and writes in core. Avoid a generic matching framework or a cosmetic distribution of branches.

## Protected invariants

- Attachments prove historical identity; latest canonical records own current edits, provider corrections, and tombstones. Preserve null versus undefined payload semantics.
- Preserve source-session keys, exact/partial attachment mapping, stable candidate ordering, duplicate ambiguity rejection, timezone provenance, and undefined versus explicit-null units.
- Deleted records remain authoritative and never resurrect. Weight and distance corrections remain independent and preserve unowned member edits.
- Preserve existing error codes/messages and fail before writes for ambiguous or changed prior evidence.
- Keep bounded raw-file scans, byte/hash validation, batch limits, one preview, optional immutable raw storage, and canonical apply ordering unchanged. Preserve expected-latest fencing and no-op audit behavior.
- No schemas, public exports, dependencies, provider prompts, tools, or deployed protocol changes.

## Scope and proof

Source: `packages/vault-usecases/src/usecases/workout-import.ts`. Focus on prior-snapshot reconciliation and directly shared exact-evidence comparison only. Tests: existing `packages/vault-usecases/test/workout-coverage.test.ts`, or one focused private test file in that package if necessary.

Use public import entrypoints and real temporary-vault/core/importer fixtures. Preserve the existing snapshot expansion, all-tombstone no-op, provider correction, independent unit correction, legacy timezone, and preview/apply race tests. Add focused boundary assertions for any newly factored matching/authority seam; do not export internals for tests.

Commands after applying the returned patch:

- `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/vault-usecases test test/workout-coverage.test.ts`
- `MURPH_TSC_PACKAGE_CHECKERS=1 pnpm --dir packages/vault-usecases typecheck`
- `pnpm complexity:diff --base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6 -- packages/vault-usecases/src/usecases/workout-import.ts`
- `git diff --check` and scoped privacy review.

No live-model journey is planned for this internal deterministic import refactor; prompt, tool selection, and reply policy are outside scope. Reassess if the returned patch crosses that boundary. Required exact-head CI owns broad proof.

## Tasks and status

1. Source, owner, and test discovery completed before implementation.
2. Parent verified the actual GPT-6 Pro implementation capture and reviewed the returned attachment; the exact patch was applied without source/test redesign.
3. Local focused verification passed; implementation is ready for a scoped draft candidate.
4. Parent owns candidate review, Ready, final ReviewGPT, exact-head CI, and completion.

Frog skill read. Normal default-store `pnpm install --frozen-lockfile` completed; `scripts/frog list` succeeded afterward. The lockfile remains unchanged. No workaround or new friction entry was needed.

## Implementation evidence

- Applied exact Pro attachment `complexity3-workout-import-retry.patch`, SHA-256 `618cd5cc15fd0f8967f96733aab0423eee107ccb9a01bcefd94ae5c1bd2e1c20`. Final source and test blobs match its expected output hashes.
- Focused native workout suite: 22 passed using real temporary-vault/core/importer seams. The new scenario assembles later partial evidence before comparing corrected units, preserves unowned distance/member fields, and proves replay adds no raw, audit, or event rows.
- New scenario also passed against baseline source; the exact candidate bytes were restored afterward. Import entrypoints and canonical persistence tail are byte-identical to baseline.
- Package typecheck with one checker, complexity guard, diff whitespace, and added-line privacy inspection passed.
- Actual metrics: debt 106 → 78, total complexity 478 → 469, maximum 61 → 61. `resolvePriorSnapshotMatches` is 59 → 12. New helpers: admission 11, attachment matching 12, snapshot comparison 31, revision 6, weight comparison 5, distance comparison 6.
- Residual hotspots: exact raw scan 22, prior raw scan 25, snapshot comparison 31, existing evidence 39, import orchestration 61. The comparison helper retains 11 debt while grouping ordered unit and source-content validation; unrelated scan and persistence orchestration remain scoped out.
- Product proof: Ready for the tested deterministic import journeys; no assistant prompt, tool-selection, reply-policy, or deployment contract changed.
Completed: 2026-09-12
