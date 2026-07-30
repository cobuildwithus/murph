# Make sponsorship songs specific to the current group conversation

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make each successful group-sponsorship celebration feel specific to the
  current room by turning a recent, non-sensitive conversation detail into a
  creative song of roughly 15 seconds.

## Success criteria

- The existing sponsorship notification prompt explicitly prefers a vivid,
  room-specific creative hook over a generic sponsor thank-you.
- The song target changes from the broad 5–15-second range to roughly 15
  seconds without increasing the existing four-line cap.
- Sensitive-context, privacy, tool, routing, and delivery safeguards remain
  unchanged.
- The focused sponsorship-notification test and affected app typecheck pass.
- Required product-experience and preliminary prompt/coverage reviews have no
  unresolved actionable findings, and exact-head PR CI is green.

## Scope

- In scope: sponsorship notification prompt text, its focused regression proof,
  the creative-notification system duration contract, their focused regression
  proofs, and the matching owner docs/product contract.
- Out of scope: sponsorship delivery/retry behavior, payment fulfillment,
  generated-song tooling, UI, schemas, or provider configuration.

## Constraints

- Technical constraints: reuse the existing creative-response notification and
  `murph.generate_song` path; add no state or runtime branches.
- Product/process constraints: preserve conversation privacy, serious-context
  restraint, participant-content trust boundaries, and the prompt-primary
  worktree/PR review lane.

## Risks and mitigations

1. Risk: specificity encourages the model to expose sensitive chat details.
   Mitigation: limit the creative premise to recent, non-sensitive material and
   retain the existing private-health/account and serious-context safeguards.
2. Risk: "creative" produces random or generic output.
   Mitigation: ask for transformation of one concrete room detail into a hook
   that could only belong to that group, and explicitly reject summary/generic
   sponsor lyrics.

## Tasks

1. Update the existing sponsorship-song prompt and matching durable product
   contract.
2. Extend the focused notification test to prove room specificity and the
   roughly-15-second target.
3. Run focused verification and direct prompt readback.
4. Run required product and preliminary ReviewGPT audits, resolve findings,
   finish the scoped commit, and complete exact-head PR gates.

## Decisions

- Change only authored instructions; the existing model/tool and delivery
  architecture already owns the requested behavior.
- Product-experience review returned `NO FINDINGS`; retain the explicit evidence
  gap that deterministic prompt proof does not demonstrate real generated audio
  quality, duration, or sensitive-context restraint.
- Preliminary ReviewGPT found that the higher-priority creative system prompt
  still allowed `durationSeconds` 5–15. Resolve the single conflicting owner by
  fixing that tool argument at 15 and leaving the dynamic task to own the
  room-specific premise and lyric pacing.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-group-sponsorship-notification.test.ts`
  - `pnpm --dir apps/web typecheck:prepared`
  - `pnpm --dir apps/web exec eslint src/lib/hosted-groups/group-sponsorship-notification.ts test/hosted-group-sponsorship-notification.test.ts`
  - focused assistant-engine planning test and package typecheck
  - `pnpm docs:drift`
  - `git diff --check`
- Expected outcomes: focused prompt assertions pass, app types remain valid,
  and the final diff contains no formatting or identifier leakage.
