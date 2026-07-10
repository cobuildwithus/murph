# Stop Codex commentary delivery

## Goal

Keep native Codex commentary internal to traces and runtime progress while
preventing it from becoming an outbound iMessage, SMS, or chat message.

Success criteria:

- Reproduce the reported text-reply shape with a focused runtime test.
- Do not call current-channel progress delivery for commentary-phase assistant
  messages.
- Preserve explicit `murph.send_progress_update` delivery, required system
  progress, final-answer delivery, steering, and media-only replies.
- Run owner coverage, typecheck, required reviews, and PR verification.

## Constraints

- Extend the existing commentary/final-fallback PR rather than create a
  competing delivery-path branch.
- Prefer deletion over a new flag, queue, state machine, or content filter.
- Keep commentary available to internal trace/progress consumers.
- Preserve unrelated work and hosted delivery/outbox invariants.
- Keep fixtures and committed artifacts free of private identifiers and
  incident message payloads.

## Evidence and root cause

- A completed Codex `assistant_message` with phase `commentary` is normalized
  correctly as non-final output.
- The current-channel bridge separately classifies that commentary as model
  progress and invokes the real outbound progress delivery surface.
- Codex already has an explicit `murph.send_progress_update` tool for the rare
  cases where a member-facing mid-turn update is warranted.
- Existing tests codify automatic commentary delivery, so the regression is
  deliberate behavior at the wrong trust boundary rather than a provider
  retry or transport duplicate.
- ReviewGPT round 3 confirmed that automatic commentary could also cross a
  steer boundary with the preceding delivery context because the progress
  callback does not carry a delivery-context ordinal.
- The same review identified `lastAgentMessage` as redundant fallback state:
  every eligible assistant message is already represented by the ordered
  assistant stream collection, and both are cleared at the same boundaries.

## Approach

1. Change focused tests to establish that commentary remains internal and
   does not consume the outbound progress budget.
2. Remove commentary from the automatic current-channel delivery extractor;
   retain system context-compaction progress and the explicit progress tool.
3. Keep the existing final-fallback exclusion so media-only and steered turns
   cannot reuse commentary as final text.
4. Delete the redundant `lastAgentMessage` fallback and use the ordered
   assistant streams as the sole text fallback source.
5. Run focused tests, assistant-engine coverage, root typecheck,
   security/privacy review, coverage review, and the PR ReviewGPT loop.

## State

Implementation and local verification are complete. The change is ready for
the scoped commit, push, PR description update, and final ReviewGPT/CI loop.

## Verification

- The focused regression failed before the delivery-boundary change because
  commentary produced an unexpected progress send; it passes after the fix.
- The complete Codex runtime file passes: 156 tests.
- Assistant-engine owner coverage passes serially: 2,012 tests passed and 4
  skipped, with all configured thresholds met.
- Root `pnpm typecheck` passes across all 27 checked workspace projects.
- Diff-aware dependency, architecture, hosted-runtime, privacy-log, and
  affected-package typechecks pass. The affected-package test stage exposed
  timing-sensitive failures under extreme shared-machine load; the exact CLI
  case passed on both the pre-fix branch state and the restored patch, and the
  exact three hosted-runtime cases passed together in isolation.
- Security/privacy review found no evidence-backed medium-or-higher finding.
- Coverage review accepted the focused runtime boundary as sufficient. It also
  confirmed that no-reply bookkeeping must stay conservative for trace/progress
  callbacks because unphased deltas may already be visible in the local CLI.
- The credential-gated real Codex test remains opt-in and was not invoked.

## Root cause

Commit `0398f4f016` deliberately routed completed commentary through the
hosted current-channel progress sink. Commit `9e57e5c596` later raised the
progress budget, making multiple narration bubbles more visible. The fix
removes that automatic model-commentary route while preserving the explicit
progress tool and required system compaction notices.

## Working set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex-events.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/assistant-codex-commentary-real-e2e.test.ts`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- PR #508

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
