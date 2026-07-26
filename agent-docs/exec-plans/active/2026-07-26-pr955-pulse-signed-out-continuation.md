# PR 955 signed-out Pulse continuation

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Land PR 955 as the smallest durable fix for a member who completes the Pulse
  Stripe flow and returns to Settings in a signed-out browser: preserve the
  signed, member-bound continuation through authentication and resume it only
  for the authenticated member.

## Success criteria

- A valid signed Pulse return opened while signed out presents the normal
  authentication-required Settings surface and preserves only the exact signed
  continuation parameters.
- After authentication, the matching member resumes the existing Settings
  continuation and POSTs the paid action; invalid, expired, duplicated, or
  wrong-member parameters remain inert.
- The speculative webhook/persisted-payment-intent recovery path, migration,
  and cross-owner reconciliation changes are removed.
- Focused tests, canonical diff verification, acceptance verification, and
  required product/review checks pass.
- ReviewGPT returns `ROUND_OUTCOME: PASS` for the exact pushed head, required
  CI is green, the PR is merged, and the task worktree is retired.

## Scope

- In scope:
  - Settings signed-out presentation and signed continuation preservation.
  - Authentication return handling for the existing Pulse continuation.
  - Focused route, component, and design-catalog coverage.
  - Removal of the rejected webhook recovery and persisted-intent state.
- Out of scope:
  - Proactive payment reminders or assistant notification outboxes.
  - A second Pulse conversion state machine, timer, cron, or queue.
  - Changes to Stripe webhook authority or paid-transition ownership.

## Constraints

- Technical constraints:
  - The server-issued signature remains the only authority for a continuation.
  - No member data or action detail is exposed before authentication.
  - Preserve current Pulse and hosted billing invariants.
- Product/process constraints:
  - Keep the fix aligned with the signed browser-return product contract.
  - Preserve the existing design-catalog proof for the authentication surface.
  - Use the immutable ReviewGPT baseline already established for PR 955.

## Risks and mitigations

1. Risk: authentication return parameters could loop or leak across members.
   Mitigation: copy only singleton signed parameters, revalidate after
   authentication, and keep invalid or wrong-member continuations inert.
2. Risk: retaining the webhook fallback would race newer member choices and
   discard an actionable Stripe URL.
   Mitigation: delete that unproven path instead of adding another state or
   outbound-message owner.
3. Risk: the PR description or review package could continue to promise the
   removed no-browser-return behavior.
   Mitigation: rewrite the PR body and ReviewGPT prompt around the narrowed,
   evidence-backed user journey.

## Tasks

1. Remove the persisted payment-intent migration, model fields, service
   wrappers, webhook recovery, reconciliation hook, and their tests.
2. Keep and tighten the signed-out Settings continuation path and focused tests.
3. Run focused and canonical verification, then inspect the final diff.
4. Update the PR description, push the exact reviewed head, and run ReviewGPT
   concurrently with CI until the required gate passes.
5. Merge PR 955 and retire the clean task worktree.

## Decisions

- Ship browser-return recovery only. The rejected webhook fallback is broader
  than the observed defect, conflicts with the current product contract, and
  requires new durable messaging semantics to be correct.

## Verification

- Commands to run:
  - Focused Vitest coverage for the Settings route, authentication-required
    component, auth dialog, and design catalog.
  - `pnpm test:diff ...`
  - `pnpm verify:acceptance`
  - PR-specific ReviewGPT final gate and required GitHub checks.
- Expected outcomes:
  - All checks pass with no accepted ReviewGPT findings on the exact PR head.
