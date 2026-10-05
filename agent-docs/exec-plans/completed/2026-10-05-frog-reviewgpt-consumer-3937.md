# Install the reviewed ReviewGPT artifact capture repair

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Consume the released upstream repairs for Frog #3937, #3958 and #3972 through
Murph's pinned registry dependency, preserving its existing review identity and
completion gates.

## Scope and constraints

- Target the published 0.5.152 release of upstream PRs #13, #14 and #15,
  each independently reviewed and merged before release preparation.
- Verify actual registry publication, signatures, provenance and release artifact
  integrity before installation; a source merge alone does not resolve the report.
- Keep the four existing consumer compatibility behaviors unless the published
  upstream implementation demonstrably supersedes one.
- Do not include unreviewed source changes or claim unreleased fixes installed.
- Use synthetic installed-package regression evidence. Preserve dependency policy,
  frozen installation, independent parent review, exact-head ReviewGPT and CI.
- This is internal developer tooling; no member-facing journey or deployment.

## Tasks

1. Verify the upstream release and exact source provenance.
2. Update the exact registry pin, scoped supply-chain entries and compatibility
   patch through the supported pnpm workflow; inspect the complete lockfile delta.
3. Exercise the actual installed package against the reported artifact behavior
   and retained identity, response timing, archive and native wake contracts.
4. Complete parent candidate review, draft PR, required ReviewGPT and exact-head CI.
5. Merge only with all gates satisfied, verify clean installation from merged main,
   close only the three matched resolved reports, and retire the clean worktree.

## Verification

- Registry 0.5.152 published through the trusted release workflow. Both registry
  ECDSA signatures, tarball integrity, and SLSA subject/source/tag/workflow/run
  bindings pass. Registry, GitHub release and clean source build contain the same
  41 files.
- Baseline frozen dependency installation passed on current main.
- Actual installed 0.5.151 passes all 28 existing consumer compatibility tests.
- The exact upstream PR #13 regression files, executed against the installed
  consumer modules, pass 40 cases and fail the seven repaired cases: prose
  layout and inline spacing, legacy artifact ordering, semantic file-reference
  controls, rendered conversation selection, and latest-request ownership.
- Baseline dependency audit retained for exact candidate comparison; existing
  advisories are not claimed to be resolved by this scoped tooling update.
- No primary-checkout changes or source-package mutation by this lane.

## Current boundary review

The merged artifact repair changes DOM text extraction, rendered conversation
selection and assistant-owned artifact activation. It does not supersede the
consumer response minimum, ZIP listing bound, native wake return, or provisional
turn identity compatibility behavior. Preserve those behaviors when porting the
patch, then rerun their installed-package regressions.

The combined release source is `3defbd3f1a24655db7a7f2e78f7c43ade7c5e47e`.
Registry publication and the exact artifact chain are verified before installation.
The actual private companion packager also reproduces #3972 against installed
0.5.151 without browser staging or upload. Its isolated exact-head checkout is
reserved for the identical 0.5.152 acceptance check. Private evidence stays local.

## Installed candidate evidence

- Frozen installation passes with exact 0.5.152, the unchanged compatibility patch
  and the existing scoped Incur override and release-age exception.
- Package dependency, optional-dependency, peer and engine contracts are unchanged.
  pnpm generated the new package resolution but also reselected existing Zod
  snapshots; those unrelated selections were restored to their exact prior lock
  records. The final lockfile changes only ReviewGPT's version, integrity and patch
  path. Frozen installation and dependency policy validate the result.
- All 83 upstream regressions from exact released source pass against the actual
  installed consumer modules, including the corrected companion alias uniqueness
  and accepted-send recovery cases. All 28 consumer compatibility tests pass.
- The actual private owner's committed packager now passes through the installed
  consumer on the same clean exact-head checkout that reproduced the 0.5.151
  rejection. Metadata is unique, full-snapshot and bound to that exact head.
  No browser starts or private archive uploads; owned staging is removed.
- Tools typecheck, CLI version/help, dependency guard and complexity guard pass.
  The release-contract suite passes 47 tests with its existing opt-in test skipped.
- Fresh dependency audit is byte-equivalent as parsed JSON to the baseline audit;
  no advisory changes are introduced. Ignored lifecycle builds remain blocked.
- Parent candidate review, exact-head final ReviewGPT and required CI remain PR
  completion gates. No issue closure is claimed before merged-main installation.

Parent candidate review passed. This plan closes the implemented consumer update
and direct verification; its PR remains the owner of pending exact-head external
review, required CI, merge, installation readback and matched issue closure.
Completed: 2026-10-05
