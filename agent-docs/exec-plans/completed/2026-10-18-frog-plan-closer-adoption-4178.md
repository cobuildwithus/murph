# Adopt the released plan-closer correction

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

- Adopt the published repo-tools correction for Frog #4178 so closing a wrapped
  Status paragraph leaves only the completed status and preserves the plan body.

## Success criteria

- Verify the released package contains the reviewed source correction.
- Prove the installed package through Murph's unchanged wrapper in synthetic
  consumer fixtures, including metadata, blank-line, heading, and EOF boundaries.
- Preserve the existing committer patch, pass dependency checks and focused
  committer tests, then complete exact-head PR review and required CI.

## Scope

- In scope: registry dependency, frozen lockfile, exact-version policy entries,
  unchanged committer patch migration, and consumer verification.
- Out of scope: the separate upstream committer repair and deployed behavior.

## Constraints

- The shared package remains the implementation owner; do not copy its closer
  into Murph. Preserve registry integrity and pnpm supply-chain controls.
- Publication and adoption were explicitly authorized after source PR #4 merged.
  Close the matched Frog report only after the consumer merge and installed proof.

## Risks and mitigations

1. An upgrade could drop Murph's existing committer correction. Carry its patch
   bytes unchanged and rerun the installed committer regression tests.
2. A new release could contain unrelated changes. Verify the registry package
   against the reviewed upstream commit and retain the narrow version exception.

## Tasks

1. Publish the reviewed upstream correction through its existing release workflow.
2. Upgrade Murph, preserve its patch, and verify the installed public boundary.
3. Review and merge the consumer PR, then verify the merge and close #4178.

## Decisions

- Source repair: https://github.com/cobuildwithus/repo-tools/pull/4, merged as
  `45b7f934cd52c803e989f9b931707f53a7250c13`; its 47 tests and ReviewGPT passed.
- The implementation adds paragraph state to the existing AWK pass; no new owner,
  dependency, product runtime path, or state abstraction is introduced here.

## Verification

- Baseline installed 0.1.17 reproduces stale continuation text in all four
  synthetic Murph-wrapper fixtures while preserving their bodies.
- Published `@cobuild/repo-tools@0.1.18` from release commit
  `d4f597a7499301513a7aab4ae4c1a3d2997a1f63`; all 31 package files match that
  commit, the registry integrity matches the tarball, and the release workflow
  passed. Its source delta contains only the reviewed plan-closer correction.
- The installed 0.1.18 package passes all four synthetic Murph-wrapper fixtures;
  archived content keeps its body and the active file is removed.
- Existing installed committer coverage: 4 tests pass. The migrated committer
  patch is byte-identical, including its lockfile patch hash.
- `pnpm deps:guard` passes for all 29 manifests; `pnpm deps:ignored-builds`
  reports none. Frozen installation succeeds with only the intended dependency
  resolution changed, including ReviewGPT's existing repo-tools reference.
- Dependency audit still exits nonzero for the same 79 pre-existing advisories;
  advisory versions, paths, and severity counts are unchanged after sorting.
  No advisory was introduced by this update.
- No authored JavaScript or TypeScript changed, so complexity measurement and a
  source typecheck do not apply. The upstream release passed its full typecheck
  and 47 tests; consumer proof exercises the installed public boundary.
- Exact-head ReviewGPT and required CI are tracked by the adoption PR. Report
  closure remains gated on that PR's verified merge and installed behavior.
Completed: 2026-10-18
