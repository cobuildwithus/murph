# Direct signup welcome

## Goal

Send the hosted signup welcome as a deterministic fixed outbound message instead
of running a model-backed notification turn for text that must be exact.

Success criteria:

- Signup welcome delivery does not call Codex/provider decision logic.
- The fixed welcome remains automatic when member activation has a routable chat
  target.
- First-contact state is marked only when delivery is accepted or queued.
- The change stays bounded to the exact-text notification path and tests.

## Constraints

- Prefer deletion and direct data flow over new schedulers, fake mailbox items,
  route-fingerprint reconciliation, or broad gates.
- Preserve generic `assistant.notification.requested` behavior for
  non-exact-text notifications.
- Do not expose secrets, raw message bodies, prompts, transcripts, local paths,
  or direct user identifiers in committed artifacts.
- Keep hosted product/control facts in `apps/web`; keep delivery/outbox behavior
  in the assistant runtime.

## Approach

1. Add a deterministic exact-text branch inside notification execution before
   provider turn execution.
2. Remove signup-specific prompt instructions that only existed to force exact
   model output.
3. Add focused tests proving exact-text notifications bypass provider execution
   and still create the expected outbox/first-contact state.
4. Keep stale same-batch suppression as temporary defensive cleanup unless tests
   prove it is dead code.

## State

Implementation complete; ready to archive through `scripts/finish-task`.

## Done

- Added a deterministic exact-text notification path that bypasses Codex/model
  execution while preserving session resolution, outbox delivery, delivery
  finalization, transcript/session persistence, and first-contact marking.
- Simplified hosted signup welcome construction to request the fixed welcome
  directly without queue-only dispatch or model-facing exact-send instructions.
- Kept the hosted runtime queue-only bypass narrow to the canonical signup
  welcome token for the wake's member-owned `userId`.
- Made canonical signup welcome failures fail the wake for retry instead of
  being swallowed by the generic first-contact failure skip.
- Added regression coverage for provider bypass, canonical queue-only bypass,
  non-canonical queue-only preservation, and signup failure retry behavior.

## Verification

- `pnpm typecheck`
- Focused Vitest for assistant-engine/runtime/web touched tests.
- `pnpm test:diff packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/test/hosted-onboarding-member-activation.test.ts`
- Final focused post-coverage rerun: `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-events.test.ts`
- Final focused post-coverage runtime typecheck: `pnpm --filter @murphai/assistant-runtime typecheck`

## Audits

- `security-privacy-review`: accepted exact-token widening finding and fixed it;
  rerun reported no findings.
- `coverage-write`: accepted missing forced-queue proof and added test-only
  coverage.
- `deep-review`: accepted canonical-token widening and signup failure swallow
  findings; fixed both. The Telegram immediate-send duplicate-on-crash concern
  is a documented residual risk because making Telegram queue-only would leave
  the observed late welcome behavior in place.

## Notes

- The fixed first welcome is one of the allowed automatic hard-coded user sends
  in `docs/contracts/00-invariants.md`.
- Avoid creating fake assistant/user transcript or mailbox items; that would
  recreate hidden conversation state.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
