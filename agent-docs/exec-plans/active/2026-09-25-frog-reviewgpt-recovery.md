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
- Narrower owner-CLI no-send trials for #2945 passed both reported sizes, but subsequent Murph-wrapper trials with the full guarded snapshot reproduced the 169,000-character multiline timeout on all three attempts. A 63,000-character multiline supplement and a larger 313,921-character mostly single-line supplement pass with complete newline-normalized readback. Raw size alone is disproved. A native one-shot insertion also failed; chunking completed but failed full-content comparison. No unproven insertion change is adopted, and #2945 remains unresolved outside the five repaired reports.
- The prior exact-head Temporal compatibility failure was a private-controller main-movement race before reader tests; the new head requires a fresh CI dispatch.
- Candidate `2d8767645be7917b35e2e5f652a636421b75e0be` passed all 37 applicable CI checks. Its review was accepted, but old message selectors could not prove the submitted turn. Supported first-export recovered the same completed conversation using the new semantic message units; original prompt, attachment, requested model, elapsed time, and checked head were verified without fabricating the missing original receipt.
- That review returned `ROUND_OUTCOME: INVALID` because the guarded snapshot contains dependency patch hunks without complete underlying owners. The exact locked registry tarball now supplies supplemental source through the supported prompt-file option; its integrity matches the lockfile, and registry-plus-patch reconstruction matches the installed package. A canonical draft-only delivery trial passes with the full snapshot.
- Adopted owner commit `fcbf795ab661132a7d072a7ff59b8f059a8717a3`: semantic message containers retain sibling attachments, and send/export share stable message-ID identities. Unknown roles, changed content, adjacent turns, and genuine capability limits still fail closed. Owner typecheck and all 303 tests pass; four additional boundary tests pass against the combined candidate.
- Final exact-head ReviewGPT with complete dependency context and current-head CI remain pending. Preserve invalid-attempt history when establishing the new initial review baseline.

- Candidate `54d8454004dea7ebe01fb5642cec34c7001ccf7c` had a pre-submit full-source supplement timeout; no request was accepted. A separate actual-wrapper differential now proves #2945: the unchanged synchronous insertion completes in 78 seconds, beyond the internal 30-second command cutoff, when only that call uses the existing configured 180-second draft budget. Full readback matches with only CRLF normalization and consecutive-newline collapse; spaces, tabs, punctuation, case, and newline positions are preserved. No user turn was sent and the exact owned target was closed.
- Adopted owner `04bceff18aa450c0b20b93e6df47233a9af1fb0b`: five source-line replacements pass the configured draft budget only to synchronous prompt insertion. Other commands retain their shorter deadline; silent insertion remains bounded. The owner passes typecheck and all 308 tests; four new regressions fail on the previous source. All 20 focused installed probe tests pass, including all five insertion-budget cases. Final review and fresh exact-head CI remain required.

- Candidate `6df0788646aa40a6ee9b429d432de87463c4a151` passed all 37 applicable CI checks. Its complete-source review successfully staged, sent, and captured the exact response, but returned `INVALID`: the reviewer could not materialize the large inline registry tarball, so no substantive verdict was reached.
- The canonical packager now expands the locked ReviewGPT registry source into its invocation-owned review context when that dependency patch changes. It derives the version and SHA-512 from the reviewed commit, downloads only that public package under time/size limits, rejects unsafe archive members, and records every source-file hash. All source files remain visible to the existing ZIP privacy checks. Eleven focused tests cover delivery and refusal paths; real registry proof expands all 41 files and strict application of the committed patch reproduces all 41 installed files. This replaces inline source encoding without adding an arbitrary attachment path.
