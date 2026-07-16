# Remove automatic computer handoff link injection

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Stop the assistant runtime from automatically appending a second
  `Take over here: <handoffUrl>` block after a computer-use pause.

## Success criteria

- A model final message is delivered unchanged after `computer_pause_for_user`,
  whether or not it contains the returned handoff URL.
- The handoff URL remains available in the tool result so the model can include
  one natural link when the user needs it.
- `finish_without_reply` remains unavailable after pausing for the user.
- Focused assistant-engine and hosted-local handoff coverage reflects the new
  one-writer behavior.

## Scope

- In scope: delete required-handoff post-processing, update the owning tests,
  and align the hosted computer-use security contract.
- Out of scope: computer handoff creation, capability authorization, browser
  checkpoint/resume state, Linq delivery idempotency, and handoff page UX.

## Constraints

- Technical constraints: preserve the existing structured pause tool result and
  same-turn computer-tool lock; add no new state or fallback owner.
- Product/process constraints: prefer deletion, preserve unrelated work, and
  follow the PR-lane ReviewGPT gate for the hosted runtime behavior change.

## Risks and mitigations

1. Risk: the model omits or mutates the URL after the deterministic fallback is
   removed.
   Mitigation: keep the exact URL in the tool result and retain prompt/skill
   guidance that tells the model to include it when a handoff is needed; cover
   the intentional no-auto-append behavior directly.
2. Risk: removing the retained URL accidentally re-enables no-reply after a
   pause.
   Mitigation: preserve the independent `computerToolsLockedAfterUserPause`
   rejection and its focused test.

## Tasks

1. Delete required computer-handoff URL retention and final-message injection.
2. Update unit and hosted-local scenario expectations.
3. Align the security contract, verify, audit, and finish through the PR lane.

## Decisions

- The pause tool remains the sole creator of the handoff and continues returning
  `handoffUrl` to the model; this task removes only the runtime's second writer.
- The request kind locks computer tools before pause execution, so the redundant
  `computerRunPausedForUser` result metadata was deleted instead of retaining a
  second state path.
- A pause clears an earlier same-context no-reply reservation at the existing
  request boundary. This keeps the model-owned final message deliverable without
  adding another message writer or fallback state.

## Verification

- Exact routed `pnpm test:diff` passed all guards, affected typechecks, six
  reverse-dependent package suites, assistant-engine's 2,233 tests (four
  skipped), and Cloudflare's 1,819 tests.
- Focused assistant-engine runtime and computer-tool tests passed: 220 tests.
- Assistant-engine and Cloudflare typechecks passed.
- Cloudflare's node suite passed: 105 files and 1,819 tests.
- Coverage-write passed after adding focused proof that a same-turn
  `computer_act` is rejected before transport after the pause.
- `git diff --check` passed.
- ReviewGPT, CI, and mergeability remain for the final pushed head.
Completed: 2026-07-15
