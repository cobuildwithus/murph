# v2 iOS Meals API boundary investigation

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Goal

- Trace canonical meals before designing the v2 iOS Meals API. If a new health
  data boundary is required, document options and stop dependent implementation.

## Success criteria

- Identify meal reads, deletion, photo lifecycle, and existing You tab endpoints.
- Publish a draft PR with costs/privacy tradeoffs and an iOS contract note.
- Do not merge, deploy, access production, or silently choose a new vault path.

## Scope

- In scope: repository inspection, existing-contract verification, and docs.
- Out of scope: implementing an unapproved runtime/replica path or changing photo
  retention. No independent new endpoint is needed.

## Constraints

- Canonical health truth remains in the member vault; upload receipts are not meals.
- Synthetic examples only. No personal identifiers or production access.

## Risks and mitigations

1. The app could mistake local upload success or stale Journal text for logged
   meals. The contract explicitly marks the meal API unavailable and proposed.
2. Legacy source and removed photos cannot satisfy the requested display fields.
   Preserve unknown provenance and existing cleanup pending a product decision.

## Tasks

1. Traced core meal writes, vault-usecase reads/deletion, query nutrition,
   assistant food-journal guidance, card rendering, and hosted photo import.
2. Checked Journal replica projection and existing contact/profile/status routes.
3. Added the integration note and indexed it; independently reviewed source facts.
4. Verified existing endpoint tests and documentation; prepare scoped commit and
   draft PR. Meal feature UX remains Hold; no runtime implementation is claimed.

## Decisions

- Recommend structured encrypted replica reads plus typed mailbox deletion.
  Approval remains open; do not implement it in this task.
- Reuse canonical soft deletion. Camera/picker provenance and photo retention
  require explicit treatment; a missing photo cannot imply a text meal.
- Reuse initial-onboarding contactAction, game home/profile, and source-scoped
  companion status. No API addition, schema change, or changelog entry needed.

## Verification

- Passed: `pnpm docs:drift`, `pnpm docs:gardening`, `git diff --check`.
- Passed: `pnpm exec tsx apps/web/scripts/run-hosted-web-vitest.mts
  apps/web/test/device-sync-companion-initial-onboarding-route.test.ts
  apps/web/test/device-sync-companion-routes.test.ts
  apps/web/test/murph-contact-routing.test.ts
  apps/web/test/game-routes.test.ts apps/web/test/game-command.test.ts`:
  5 files, 216 tests. These prove existing mocked route/unit boundaries, not
  production behavior or a future Meals API.
- Typecheck and complexity metric do not apply: only Markdown changes.
- Frozen dependency installation resolved absent local tooling; Frog list then
  succeeded. No new repository friction entry was necessary.
- ReviewGPT is exempt for this docs-only change. Broad required CI is held by
  the requested Draft state; do not mark Ready merely to trigger it.
Completed: 2026-11-01
