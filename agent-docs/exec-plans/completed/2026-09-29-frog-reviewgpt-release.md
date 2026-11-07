# Release and install reviewed ReviewGPT history-loading fix

Status: completed
Created: 2026-09-29
Updated: 2026-09-30

## Goal

Install the reviewed upstream history-pagination capture fix for Frog issue #3899 and the verified attachment-notice staging fix for #3873 through a registry release and Murph's declared dependency.

## Success criteria

- The upstream patch release contains the independently reviewed fix and passes its release checks.
- Murph installs the exact published version through a frozen lockfile without losing existing review gates or patch behavior.
- Installed-package regressions, dependency guards, parent review, exact-head ReviewGPT and required CI pass before landing.
- Verify merged source and installed behavior before closing each matched issue. For #3873, also prove installed same-thread follow-up staging without a send; retain it open if that historical-path evidence remains unavailable.
- For #3873, retain the upstream controlled late-notice CLI proof without a send, run the actual installed notice helper's positive/negative controls, and verify the compatibility patch preserves the composed readiness hooks.

## Scope

- Release metadata, the ReviewGPT dependency and lockfile, compatibility patch retirement or preservation, and focused installed-package proof.

## Constraints

- Preserve isolated worktrees, owner-approved commit identities, supply-chain controls and unrelated work.
- No production deployment or broad sibling-repository sync from this lane.
- The modified reviewer is not the sole proof of its own correctness: preserve independent source regression and native review evidence.

## Risks and mitigations

1. An older consumer patch might carry behavior missing upstream. Compare all patched source surfaces and run existing consumer regressions before removing it.
2. Newly published artifacts require an exact, scoped age exception. Preserve every other supply-chain policy and inspect the package inventory and registry integrity.

## Tasks

1. Verify source provenance and prepare the supported isolated upstream patch release.
2. Inspect release metadata, publish through the trusted tag workflow, and verify registry identity.
3. Update Murph's exact dependency and preserve or retire the existing patch based on source evidence.
4. Run installed-package tests and dependency checks; obtain parent review and exact-head external review alongside CI.
5. Land, verify installation and closure, then retire clean worktrees.

## Decisions

- Use the upstream helper's supported non-main release mode and disable broad post-release sibling sync.
- The reviewed history fix is upstream PR #6; source review and its independent test evidence remain part of acceptance.
- Publish the independently reviewed fixes through the supported upstream release workflow. Keep one final Murph dependency PR for 0.5.151, including the separately reproduced informational attachment-dialog correction after its own review and release gates.
- Retain the four downstream behaviors still absent upstream: minimum capture duration, bounded ZIP listing capacity, return to the native calling session, and provisional-turn identity recovery. Rebase only those hunks so the new upstream canonical UUID and attachment-signature checks remain intact.
- Verify source merge, registry publication, consumer merge and a clean task-worktree installation as separate stages. Leave the primary checkout and machine-wide installation unchanged.

## Verification

- Upstream: typecheck, full tests and release pack check.
- Consumer: frozen install, relevant ReviewGPT test suites, dependency guard/audit/ignored-build review and complexity guard.
- Exact-head CI and ReviewGPT must pass before landing.

## Progress

- Upstream PR #6 is merged. Release metadata PR #7 is merged, and the supported release workflow published 0.5.149. Registry integrity matches the release artifact; its provenance identifies the reviewed tag commit and trusted publisher workflow.
- The 0.5.149 artifact passes a frozen registry installation and 21 installed-package checks. The added history-loading regression failed on 0.5.147 and passes on 0.5.149. Existing duration, capture identity, deadline, archive and native-wake checks pass.
- Dependency policy, ignored-build review, tools typecheck and complexity checks pass for the preliminary consumer update. The dependency audit remains nonzero with the same advisory objects, affected versions and dependency paths as the committed baseline; the update introduces none.
- Upstream PR #8 passed 320 tests, typecheck, independent parent review and final ReviewGPT, then merged. Release 0.5.150 is published; its registry tarball exactly matches the GitHub release artifact, and SLSA provenance identifies the reviewed tag commit and successful publisher workflow.
- Frozen registry installation of 0.5.150 passes all 23 installed-package tests across five files. The UUID-alias positive control failed on 0.5.149 and passes on 0.5.150; changed-UUID and existing identity controls pass. The CLI reports 0.5.150 and its help command succeeds.
- Final dependency policy, ignored-build review, tools typecheck and complexity checks pass. The audit's 54 advisory objects and 144 affected findings exactly match the committed baseline, including affected versions and dependency paths; no advisory is introduced.
- The compatibility patch is reduced from 3,080 to 284 lines across eight files. Upstream canonical UUID and legacy attachment-signature comparisons remain untouched. Only the four previously required downstream behaviors remain.
- Candidate implementation and local proof are complete. Parent review, exact-head ReviewGPT, required CI, consumer merge and a clean task installation from merged main remain delivery gates.
- Parent review of the 0.5.150 consumer candidate passes, including an independent 15-test run of capture identity and response minimum suites. Hold the scoped commit for 0.5.151; add installed-package proof for its narrow informational-dialog correction before the final PR. No timeout reduction, duplicate send, storage change or review-gate relaxation is authorized by that repair.
- A separate upstream capture defect was reproduced during that review: a 320-character signature ending in whitespace is trimmed only on the expected side. The new installed selector/model-attestation positive control fails on 0.5.150, while its changed-signature negative control and seven other cases pass. Include the independently reviewed correction in 0.5.151 and preserve the original raw-signature SHA-256 binding.

- Final upstream 0.5.151 is published from the reviewed tag commit. Registry ECDSA signatures, tarball integrity, exact GitHub release artifact bytes and SLSA provenance all pass. The cumulative source review covers the attachment correction and raw-signature fix with direct generation-duration evidence; source tests pass 345 cases and typecheck.
- The final compatibility patch differs from the reviewed 0.5.150 patch only in three line offsets. Upstream raw-signature selector, attestation, informational-dialog and composed readiness owners remain byte-identical. The controlled no-send CLI proof's notice owners are also byte-identical in the installed artifact.
- Frozen registry installation of 0.5.151 passes all 28 installed-package checks across six files, including trailing-space identity and changed-signature controls, verified-notice dismissal and blocked additional decisions. CLI help, tools typecheck, dependency policy for 29 manifests, ignored-build review and complexity checks pass.
- A fresh audit of the committed dependency baseline and candidate returns identical 120 advisory objects and 144 affected findings, including affected versions and paths. The earlier 54-object result reflected the older registry response; no advisory is introduced by this candidate.
- The final lockfile remains limited to nine added and nine removed ReviewGPT lines, matching pnpm's generated resolution, patch, importer, override and snapshot records. Final parent review, exact-head ReviewGPT, required CI, consumer merge and clean installation from merged main remain pending.
- Parent full-diff and compatibility-patch review finds no code or scope issue. Closure of #3873 additionally requires actual installed same-thread follow-up staging on an exclusively owned completed conversation without a send; the fresh-draft notice proof alone does not establish that historical path.
Completed: 2026-09-30
