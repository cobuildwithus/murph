# ReviewGPT Browser Lanes

## Goal

Spread ReviewGPT PR-review load across the existing managed browser lanes by
default, while keeping a simple env override for pinning a specific lane during
debugging or recovery.

## Constraints

- Keep the PR ReviewGPT loop on guarded pushed-head artifacts.
- Do not add a scheduler, durable usage state, or a new orchestration service.
- Preserve existing manual overrides for browser binary, user-data dir, profile,
  and CDP port.
- Keep ReviewGPT artifacts local and uncommitted.

## Plan

1. Add a small lane selector to `scripts/review-gpt.config.sh`.
2. Update PR ReviewGPT workflow docs to describe random default selection and
   explicit lane pinning.
3. Run shell syntax, ReviewGPT dry-run proof, and required low-risk tooling
   verification.

## Verification

- Passed: `bash -n scripts/review-gpt.config.sh`
- Passed: `REVIEW_GPT_BROWSER_LANE=phlebas pnpm review:gpt pr-review --dry-run`
  - Confirmed lane-specific package prefix and Phlebas managed browser endpoint.
- Passed: `REVIEW_GPT_BROWSER_LANE=eragon pnpm review:gpt pr-review --dry-run`
  - Confirmed Eragon endpoint.
- Passed: `REVIEW_GPT_BROWSER_LANE=mountain pnpm review:gpt pr-review --dry-run`
  - Confirmed Mountain endpoint.
- Passed: `pnpm review:gpt pr-review --dry-run --no-zip`
  - Confirmed unset default selects a managed lane.
- Passed: `REVIEW_GPT_BROWSER_LANE=aragon pnpm review:gpt pr-review --dry-run --no-zip`
  - Confirmed alias resolves to Eragon.
- Passed: `pnpm typecheck`
- Passed: `git diff --check -- <touched files>`
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
