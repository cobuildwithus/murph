# PR 221 CI and ReviewGPT follow-up

## Goal

Fix the red PR checks for Telegram voice memo delivery and run the external
ReviewGPT loop to zero accepted findings.

Success criteria:

- Red CI checks are traced to concrete failing assertions or scenario evidence.
- CI fixes are limited to the smallest production/test surfaces.
- Every ReviewGPT finding is verified against code before accepting or rejecting.
- Accepted findings are fixed with focused proof.
- Required verification passes before the branch is pushed.

## Constraints

- Do not push or merge to `main`.
- Preserve unrelated active-plan and working-tree edits.
- Do not expose secrets, direct user identifiers, local account names, or home
  paths in committed files or handoff text.
- Hosted runner cleanup must remain fail-closed when process isolation cannot be
  proven.

## Approach

1. Inspect the failing GitHub checks and local failing tests.
2. Patch stale test expectations and the hosted runner cleanup timing proof.
3. Run focused owner verification, then broader required checks as feasible.
4. Commit and push only this task's scoped branch changes.
5. Resolve ReviewGPT rounds until no accepted findings remain.

## State

Active.

## Notes

- PR CI showed a hosted-web app verification assertion still expecting old
  landing-page copy.
- Hosted-local Linq delivery reached the expected delivery behavior, then failed
  during runner process cleanup because post-kill isolation proof did not settle
  before the one-second timeout.
- Manual Cloudflare Hosted E2E dispatch for the CI-fix head completed
  successfully across all jobs.
- ReviewGPT round 1 accepted findings fixed in the current working tree:
  Telegram voice memo audio is prepared before companion text delivery; ambiguous
  voice-only Telegram sends without provider ids are abandoned instead of
  retried; Telegram delivery-time TTS no longer creates an early usage draft;
  voice memo capability now flows as the explicit delivery channel only.
- Remaining ReviewGPT usage-accounting gap is being handled at the hosted
  ElevenLabs egress boundary so each successful platform TTS provider request,
  including delivery retries, records one character-count usage row without
  adding a second delivery-accounting path inside assistant-engine.
- Stale ReviewGPT result after the usage fix confirmed the first gap is fixed
  by hosted egress metering, and surfaced a still-valid hosted ordering bug:
  hosted supplied an all-in-one Telegram voice-memo send dependency, so the
  descriptor skipped pre-text audio preparation for text-plus-voice replies.
  Current fix makes the descriptor the only Telegram text/voice orchestrator and
  passes hosted env/fetch as a lower-level voice-memo runtime dependency.
