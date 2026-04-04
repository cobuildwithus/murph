# Release CI Speedup

## Goal

Reduce tag-driven release time by removing duplicated install/build/pack work from the release path and enabling the existing safe parallel verification lanes in CI for release checks.

## Scope

- Update the tag-driven release workflow and focused release-check path.
- Keep release verification behavior equivalent at the repo-acceptance level unless a duplicated lane is intentionally removed.
- Update durable testing/verification docs to match the new release behavior.

## Constraints

- Keep the change narrow to release workflow, release-check script, and durable verification docs.
- Preserve existing release guards around tag validation, package packing, and npm publish ordering.
- Do not overwrite unrelated dirty-tree changes outside this release lane.

## Verification

- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm build`
- `node scripts/pack-publishables.mjs --clean --out-dir <tmp>/tarballs --pack-output <tmp>/pack-output.json`

## Status

- In progress

## Notes

- The current tree already carries the tag-release workflow env overrides for `MURPH_TEST_LANES_PARALLEL`, `MURPH_APP_VERIFY_PARALLEL`, and `MURPH_VERIFY_STEP_PARALLEL`, so this lane aligned the release-check script, root build script, tests, and durable docs to that workflow behavior without needing a new `.github/workflows/release.yml` diff.
- `pnpm test:coverage` is still red for the unrelated active knowledge-lane error at `packages/cli/src/knowledge-runtime.ts:188` (`relatedSlugs` type mismatch inside `build:test-runtime:prepared`).
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
