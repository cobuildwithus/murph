# Remove onboarding launch songs

## Outcome

Remove automatic launch songs from onboarding while preserving the mandatory
text close, reminders, and review. Keep the independently useful Telegram
fallback that delivers accompanying text when a transcriptless requested song
cannot be prepared.

## Root cause

Automatic onboarding-song behavior was spread across the system overlay,
onboarding flow, behavior owner, music prompt craft, and durable spec. The
Telegram exception also exposed a real delivery gap: the voice-memo fallback
covered speech transcripts, but a song has no transcript and could still lose
its accompanying text when preparation failed.

## Scope

- Make the onboarding launch close text-only in `behavior-followthrough`.
- Remove automatic onboarding-song policy and completion requirements from the
  system overlay, onboarding skill, music skill, tool description, and durable
  spec; remove the stale changelog promotion and keep the durable-doc index
  aligned.
- Preserve accompanying Telegram text when transcriptless song preparation
  fails, at the channel delivery owner.
- Keep explicitly user-requested songs available as ordinary current-request
  media; they do not become part of onboarding.
- Do not add persisted state, a second delivery owner, or runtime branching.

## Verification

- Focused assistant prompt and skill tests.
- Focused Telegram transcriptless-song preparation fallback test.
- Focused changelog registry test.
- Canonical `pnpm test:diff` for the touched owners.
- Product review required by the completion workflow.

## Coordination update — 2026-07-22

PR #870 (`codex/onboarding-voice-modality`) now owns the combined onboarding
prompt/runtime removal, age-aware voice help, modality-matched labs closer, and
the general Telegram transcriptless-media text fallback. Please do not publish
a duplicate overlapping implementation. Preserve the independently useful
changelog cleanup in this lane and coordinate it into PR #870 or a clean,
non-overlapping follow-up; do not discard unrelated user or agent work.
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
