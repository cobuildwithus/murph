# Restore the one-time onboarding stall check-in

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and owner

Restore one optional early onboarding nudge through the existing injected
opening instructions and canonical automation tool. The opening identity child
continues saving supplied facts independently. No new scheduler, queue, or state
owner is needed. PR #3673 deleted the scheduling recipe and explicitly forbade
it in both injected and routed guidance; that is the proven cause.

## Product UX

- Outcome: one pressure-free check-in when a new direct onboarding conversation
  stalls, scheduled fifteen minutes after the identity answer or skip.
- Reaches: onboarding is still open, the latest message is Murph's onboarding
  question, it has been unanswered for ten minutes, and no pause was requested.
- Proof: deterministic composed policy assertions, a real-model identity/save
  journey, canonical automation readback, and scheduled send/skip replays.
- Preserve: no repeated nudge, no later-resume rearming, immediate-request
  priority, explicit pause/decline, and the finite next-day recovery owner.

## Decisions and risks

- Restore the existing root-owned automation save. Children cannot inherit its
  invocation authority. This adds one bounded save to the opening turn; do not
  claim a latency improvement or create a detached authority workaround.
- Tool absence or save failure is best effort: continue without retry or a
  user-visible scheduling error. Existing records require no migration.
- This is a prompt-primary restoration. No runtime, schema, tool contract, or
  delivery owner changes; focused model proof and parent review apply.
- Keep completed historical plans immutable; update the current product owner.
- The live fixture now derives native delegation hints from the hosted config
  owner and advertises its actual automation port. Both mismatches are covered
  by deterministic tests and recorded in the task-owned Frog entry. No hosted
  configuration or runtime dependency changed.

## Tasks

1. Restore the injected recipe, routed references, and current product contract.
2. Restore and strengthen regression proof, including scheduled suppression.
3. Run focused tests, typecheck, model journey, and content checks.
4. Review the full diff, record evidence, close this plan, and commit the scope.

## Verification

- Passed: `pnpm --dir packages/assistant-engine test test/model-behavior.test.ts test/assistant-skill-assets.test.ts` (113 passed, seven pre-existing skips).
- Passed: assistant-engine project-reference build and `pnpm --dir packages/assistant-engine typecheck`.
- Passed: changelog generation and all ten archive rendering tests.
- Passed: `pnpm complexity:diff`; existing untouched hotspots remain at 28 and 25.
- Passed: `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`.
- Passed: two additional fixture tests for production-derived delegation hints
  and truthful automation availability. Final assistant-engine typecheck passed.
- Passed: `pnpm test:assistant:live -- --test "continues the opening while one native child saves identity and one stall check-in respects silence" --model gpt-6-sol`
  through local subscription authentication. Earlier profiles failed before
  actions; the first working profile exposed the fixture contradictions above.
  Those were corrected and verified on the same profile without weakening the
  product assertions.
- Live effects: one identity child, three canonical identity facts read back,
  exactly one canonical check-in due fifteen minutes later. Root performed no
  identity saves and did not claim background completion. The reply took
  22,679 ms in this synthetic local run, not a production latency guarantee.
- Scheduled replays used the actual model-saved instructions and production
  scheduled prompt: stalled sent one gentle message; replied, recently asked,
  paused, and completed each skipped. No follow-up chains or record changes.
- Product UX: Ready for the local change. Reviewed the opening and scheduled
  reply: clear, pressure-free, truthful, one question, and no internal details.
- Parent review: source restores the existing recipe without new runtime state
  or authority. Pause, completion, no-repeat, and missing-tool rules remain.
  No PR merge, production deployment, or production delivery is claimed.
Completed: 2026-09-23
