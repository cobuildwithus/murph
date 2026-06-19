# PR 212 ReviewGPT Round 2 Fixes

## Goal

Fix accepted ReviewGPT round 2 findings for PR 212 while keeping voice memo
delivery Linq-native and simple.

Success means hosted deploys can provide the default ElevenLabs voice id,
voice memo generation is only allowed when the current reply can actually
deliver one Linq voice memo, ambiguous media-only voice memo send failures are
recorded as ambiguous instead of retryable/definite failures, the old boolean
media-capability compatibility path is removed if still safe, tests prove the
behavior, and the PR branch is pushed for the next ReviewGPT round.

## Constraints

- Preserve a single Linq-native voice memo delivery path.
- Do not add a general capability framework or public voice memo URL delivery.
- Keep pre-generation validation close to the dynamic tool and existing turn
  context.
- Keep non-idempotent delivery ambiguity fail-closed.

## Plan

1. Verify each round 2 finding against current code paths.
2. Patch accepted deployment, pre-generation validation, ambiguity, and
   complexity-collapse fixes.
3. Run focused tests, typecheck, and diff-aware verification.
4. Commit, push, and rerun the external PR deep-review loop.

## State

Patched accepted round 2 findings and local deep-review follow-ups; local
verification passed; ready to commit, push, and rerun ReviewGPT.

## Notes

- Deploy workflow/optional vars now include `MURPH_ELEVENLABS_VOICE_ID` and
  `MURPH_ELEVENLABS_MODEL_ID`.
- Voice memo dynamic tool now fails before provider/upload calls unless the
  current turn can deliver one Linq voice memo and no response media is already
  attached.
- Media-only Linq voice memo transport ambiguity now uses the existing
  no-provider-id ambiguous outbox path.
- Channel media capability now uses only `supportedResponseMediaKinds`.
- Local deep review found and verified two follow-ups: the image-only
  `attach_response_media` tool now rejects `voice_memo` payloads, and voice memo
  generation availability no longer trusts ambiguous Linq explicit targets.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
