# PR 212 ReviewGPT Round 4 Fixes

## Goal

Fix accepted ReviewGPT round 4 findings for PR 212.

Success means voice memo generation records billable ElevenLabs usage, the
voice memo tool availability check matches the actual selected Linq delivery
route, unused Linq voice memo download URL state is removed if safe, focused
tests prove the fixes, and the PR branch is pushed for the next ReviewGPT
round.

## Constraints

- Keep usage accounting in the existing assistant usage draft pipeline.
- Keep route gating in the existing delivery candidate helpers; do not add a
  separate voice memo router.
- Prefer deleting unused persisted provider state over carrying speculative
  fallback data.

## Plan

1. Verify the ReviewGPT round 4 findings against current code.
2. Patch usage accounting and route gating with focused tests.
3. Remove unused Linq voice memo download URL plumbing if no current consumer
   requires it.
4. Run scoped verification, commit, push, and rerun ReviewGPT.

## State

Implementation patched, including local-review empty-audio accounting fix.
Focused tests, repo typecheck, and `git diff --check` pass. The broad diff
lane passed the touched package checks after the empty-audio follow-up, then
hit a transient `packages/setup-cli` wizard failure; the specific failing test
and full `packages/setup-cli` suite passed on rerun.

## Notes

- Round 4 findings: ElevenLabs TTS usage is not billed; voice memo availability
  can validate the stored thread while delivery later uses an explicit override;
  Linq voice memo download URLs appear unused in persisted response media.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
