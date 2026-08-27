# Run the Garmin canary in headed Kernel Chromium

Status: completed
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Make the protected Junction Garmin canary complete unattended through Kernel
  despite Garmin's Cloudflare challenge while preserving exact callback,
  persisted-state, disconnect, and deregistration proof.

## Success criteria

- Kernel runs remote Chromium in headed mode without enabling manual CI input.
- Focused config and workflow tests prove the headed unattended contract.
- ReviewGPT and required exact-head CI pass.
- The merged `main` workflow completes the real Garmin canary successfully.

## Scope

- In scope: the Kernel transport headless restriction, protected workflow config,
  focused tests, and directly affected operational documentation.
- Out of scope: provider-specific CAPTCHA solving, credential changes, retries,
  Junction production behavior, and Oura/WHOOP flow rewrites.

## Constraints

- Technical constraints: keep the browser remote and stealth-enabled, keep CI
  unattended and fail-closed on provider challenges, and preserve secret
  partitioning and the source-specific persistent profile.
- Product/process constraints: smallest maintainable correction, no new
  dependency or runtime owner, PR lane with ReviewGPT, exact-head CI, and a
  post-merge protected canary pass.

## Risks and mitigations

1. Risk: Headed mode could accidentally permit manual authorization in CI.
   Mitigation: derive manual authorization independently from `CI`; add a
   regression test proving headed Kernel in CI remains unattended.
2. Risk: The change could weaken challenge detection.
   Mitigation: leave challenge classification and fail-closed behavior intact;
   change only Chromium display mode.

## Tasks

1. [x] Update the Kernel config boundary and protected workflow to use headed
   remote Chromium for Garmin.
2. [x] Add focused regression coverage and align the operational contract.
3. [x] Run focused tests, typecheck, docs drift, and privacy/diff review.
4. [x] Open the follow-up PR and resolve the required ReviewGPT gates.
5. [ ] Merge after exact-head CI and prove the protected `main` Garmin canary
   succeeds. This remains the merge owner's fail-closed completion boundary.

## Decisions

- Treat the two reproduced Cloudflare challenge failures as root-cause evidence;
  do not add retries or classify the challenge as success.
- Use Kernel's existing headed automation capability; do not add a CAPTCHA
  solver or a new browser service.
- Preserve an upstream pre-effect admission check because the live suite resets
  and deregisters provider state. Align that check with the browser-child gate
  and cover the exact workflow-shaped handoff instead of deleting it.
- Treat headed Chromium as a mitigation until a protected post-merge run proves
  the real provider flow; do not claim success from static or simulated tests.

## Verification

- Focused browser authorization suite: 30 tests passed.
- Workflow contract suite: 7 tests passed.
- Live-suite configuration boundary: 6 tests passed and the 7 real-provider
  cases remained intentionally skipped by the focused filter.
- Web, Cloudflare, and hosted-local harness typechecks passed.
- `pnpm docs:drift` and `git diff --check` passed; the privacy scan found no
  direct personal identifier in the patch.
- Preliminary ReviewGPT found the stale upstream headed-Kernel rejection and an
  overclaim in the verification guide. Both were accepted and corrected with a
  narrow predicate, direct regression tests, and wording only.
- Final ReviewGPT round 1 independently found the same upstream rejection. It
  was accepted and corrected; no finding was rejected.
- Final ReviewGPT round 2 performed a fresh full-snapshot audit of the corrected
  head and passed with no findings.
- Required PR CI and the protected post-merge Garmin run remain authorization-
  boundary checks. The task must not be reported shipped unless both pass.
Completed: 2026-08-22
