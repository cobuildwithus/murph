# Adopt proven ReviewGPT recovery fixes

Status: active
Created: 2026-09-25
Updated: 2026-09-25

## Goal

- Make Murph's installed ReviewGPT recover the exact accepted review across the proven browser and capture failures without weakening message, target, or snapshot identity.

## Success criteria

- Reproduce each accepted defect using synthetic inputs and the installed dependency entrypoint.
- Adopt tested owner changes through the existing registry-sourced dependency patch, retaining all existing Murph corrections.
- Pass focused installed-package regressions, relevant typecheck, dependency guards, parent review, exact-head ReviewGPT, and required CI.
- Close only reports whose full claimed failure is resolved by the delivered change; retain an explicit disposition for unproven residuals.

## Scope

- In scope: existing ReviewGPT dependency patch, patch hash, focused installed-package proof, and the current review-tool contract where its supported CLI changes.
- Out of scope: package publishing, production runtime changes, credentials, private browser evidence, weakened capture guards, and speculative prompt-editor work.

## Constraints

- Technical constraints: keep the registry version and supply-chain policy; preserve existing patch behavior and exact accepted-message identity.
- Product/process constraints: isolated task checkout, synthetic tests, scoped commits, draft-before-push, final exact-head review and CI. External owner repairs are independently tracked and do not alone prove Murph installation parity.

## Risks and mitigations

1. Risk: replacing the dependency output could discard existing Murph patches.
   Mitigation: compare the pristine registry package, existing patched package, and owner diff; transplant only proven changes and rerun existing regression coverage.
2. Risk: browser recovery could select a different conversation or response.
   Mitigation: retain strict target/message/content identity and test both recovery and rejection paths.

## Tasks

1. Finish current owner reproductions and implementation in the ReviewGPT repair lane.
2. Apply its stable changes to the existing dependency patch; verify source and emitted runtime parity.
3. Add focused installed-package regressions, run required checks, and review the complete diff.
4. Open a scoped draft PR, complete exact-head review and CI, and record landing prerequisites and per-issue dispositions.

## Decisions

- The user explicitly authorized cross-owner repairs and standard isolated worktrees. Existing release/publish restrictions remain in force; registry patch integration avoids an unrequested package release.
- Initial issues are #2440, #2588, #2787, #2937, #2945, and #3105. Admission of a code change depends on its own concrete cause; prompt size alone did not reproduce #2945.

## Verification

- Commands to run: focused repo-tool installed-package tests; root tooling typecheck; dependency guard/audit and ignored-build inspection; complexity and diff hygiene; guarded final ReviewGPT; required exact-head CI.
- Expected outcomes: exact review identity survives the corrected presentation/recovery cases, unrelated targets and changed messages still fail closed, and frozen dependency installation is reproducible.

## Progress

- Adopted the source from upstream PR `cobuildwithus/review-gpt#5`, source commit `6211bc729b9cb5db9e5bc66dc6456c33a633b3d4`. Its later test-only commit does not change the adopted source. The owner passed typecheck and 286 tests, followed by canceled-download and wrong-download-identity cases.
- Regenerated emitted code from the combined source with the owner's compiler settings. Preserved every earlier Murph runtime correction; corrected one pre-existing patch-only parameter annotation to admit the optional signature type without changing emitted behavior.
- Frozen installation passes. The lockfile changes only the ReviewGPT patch hash in its three existing locations; dependency versions and supply-chain settings are unchanged.
- Four installed-package regression files pass all 14 tests, including the two timeout cases that failed on the prior patch, healthy connection reuse, prior capture-identity recovery, wake-owner delivery, and archive listing. Root tooling typecheck passes.
- The owner reproduced the code-badge identity defect in a real isolated synthetic browser and verified the corrected extractor. An actual guarded companion dry-package run verified exact PR/head metadata and archive privacy; no browser upload was needed.
- Initial #2945 trials were blocked before the actual editor because managed profiles were open without CDP; native synthetic control success alone was insufficient. Later canonical actual-editor results below supersede that evidence gap without claiming a historical root cause.
- The unchanged dependency baseline audit reports high/critical advisories elsewhere in the existing graph. This patch does not claim to remediate those unrelated dependency versions.
- Canonical local tooling verification passed all guards, 864 tests across 58 files, and dependency policy for 29 manifests.
- The initial candidate `e42d3915421a4fa4ee0541952b7e708cfc84ee32` had two invalid final-review attempts before submission: one profile lacked CDP, and another refused an unconfirmed regular Chat surface. Neither produced an accepted request or substantive review.
- A separate exact-function reproduction proved an early-refusal race after an authorized Chat click: Work → Work → Chat failed after 200 ms despite a 12-second deadline. Adopted the bounded polling correction from owner commit `dc40c696f9a476fd54e062993fa850ea52701143`; its focused tests retain one click, the deadline, and no-switch/missing-toggle rejection. The saved live failure cannot conclusively be attributed to this race, and #2945 remains unresolved.
- The three switch cases also pass against the installed patched staging function, and all 14 prior installed regressions still pass. The updated patch again installs with the frozen lockfile.
- The next pre-submit attempt at `87fe67f227259342649babefe2cdb80c2da5e54f` exposed the actual live mismatch: Chat/Work are semantic pressed buttons, but the probe recognized only radios and mistook the Work toggle label for a breadcrumb. A fresh task-owned page proved the old false-Work result and the corrected Chat-selected result, without sending or inspecting another page.
- Adopted owner commit `01d7c3c8f45621d5a8052e958ff4aea7028ccf2b`, which recognizes pressed buttons and excludes only recognized controls from breadcrumb evidence. Owner typecheck and all 295 tests pass; seven surface cases and all 14 prior regressions pass against the installed package. Genuine Work selection, usage, independent breadcrumbs, unknown controls, and the existing switching restrictions remain rejected.
- The next pre-submit attempt at `ef1b83a974316265a7520472def0da462c0c5a3b` passed the Chat guard but failed to find the current semantic model control. Adopted owner commit `a9280c2d74580b82811899ab87e1557edf33ce2d`: recognizes the explicitly labelled model trigger and visible selected-model row while rejecting ambiguous effort labels and wrong versions. Owner typecheck and all 299 tests pass.
- Current canonical no-send trials for #2945 stage both 63,000- and 169,000-character prompt files with the guarded owner snapshot and verified GPT-6 Pro. Both retain complete content after renderer newline normalization, attach the snapshot, create no user turn, and close only their exact owned target. The historical timeout is not reproduced; these results do not establish its original cause.
- The prior exact-head Temporal compatibility failure was a private-controller main-movement race before reader tests; the new head requires a fresh CI dispatch.
- Final exact-head ReviewGPT and CI remain pending. Preserve invalid-attempt history when establishing the new initial review baseline.
