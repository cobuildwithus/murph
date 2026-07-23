# Hercules ReviewGPT Lane

## Goal

Make the existing Hercules managed browser profile a first-class ReviewGPT lane,
prove that an explicit Hercules run selects the configured GPT-5.6 Pro review
model, and remove the obsolete `Coming next week` pill from the homepage Auto
Meal section now that automatic meal ingestion is live. Document the required
Crabbox fallback when a local canonical check waits more than 10 minutes for the
shared-host slot.

## Constraints

- Preserve the existing Eragon, Phlebas, and Mountain lane behavior and the
  `aragon` alias.
- Use the existing Hercules profile and native launcher; do not create another
  browser profile, scheduler, or usage state owner.
- Keep ReviewGPT on the canonical `gpt-5.6-sol` request, whose completed UI
  response attests as the GPT-5.6 Pro response slug.
- Preserve unrelated homepage copy and layout.
- Keep live ReviewGPT artifacts local and uncommitted.

## Plan

1. Add Hercules to the lane name, port, explicit-pin, and random-selection
   configuration.
2. Update the durable ReviewGPT loop documentation and focused regression
   assertions.
3. Delete the obsolete Auto Meal availability pill and update its static test.
4. Run focused verification plus an explicit Hercules dry run and live
   send/wait model-attestation check.
5. Add the ten-minute local-admission fallback to the completion and verification
   docs, with focused regression assertions.
6. Perform final scope review and finish through the plan-aware commit path.

## Verification

- Homepage regression: the focused Auto Meal section test passed (1 test),
  including the assertion that `Coming next week` is absent.
- ReviewGPT/tooling regression: the focused release-script coverage audit
  passed (39 tests, 1 skipped), and `bash -n scripts/review-gpt.config.sh`
  passed.
- Canonical changed-path verification: `pnpm test:diff ...` passed across repo
  tooling (411 tests), CLI (1,079 tests, 1 skipped), web (6,127 tests, 153
  skipped), lint (0 errors), development smoke, and the production build.
- Hercules dry-run proof: an explicit `REVIEW_GPT_BROWSER_LANE=hercules` run
  resolved the Hercules profile, app, and CDP port `9444` while requesting the
  configured `gpt-5.6-sol` model.
- Hercules live proof: the send/wait smoke completed in the Hercules lane and
  its response sidecar reported `responseModelSlug: gpt-5-6-pro` for the
  `gpt-5.6-sol` request.
- Ten-minute fallback regression: focused coverage passed after the completion
  and verification docs were updated.
- Canonical acceptance fallback:
  `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed on one-shot
  Testbox `tbx_01ky5qhat1wp7q09sts7v32m33` in 5m40s and stopped the Testbox
  after success. Actions evidence:
  `https://github.com/cobuildwithus/murph/actions/runs/29954418489`.
- Final patch hygiene: `git diff --check` passed.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
