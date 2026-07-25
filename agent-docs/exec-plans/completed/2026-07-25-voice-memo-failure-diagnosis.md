# Voice memo failure diagnosis

## Goal

Make a failed Murph voice memo say why it failed, and stop accepting memo text
that cannot physically synthesize before the request timeout.

Success criteria:

- A failed generation reports the provider status or failure stage in both the
  model-visible tool result and a runtime log line.
- The accepted voice memo text length and the speech request timeout are one
  documented decision that cannot silently drift apart.
- Focused coverage proves the HTTP, transport, and over-length failure classes
  stay distinguishable from each other.

## Constraints

- Secret-safe only: status codes, stage names, timings, and error names. Never
  response bodies, credentials, or memo content.
- No retry, queue, or lifecycle machinery. The gap is discarded information,
  not a missing recovery mechanism.
- Preserve every existing precondition message the tool already returns.

## Approach

1. Add one shared `describeVaultCliFailure` summary on the module that owns
   `VaultCliError`, so the ElevenLabs and Linq swallow sites read the same
   `status` / `failureStage` / `timedOut` / `elapsedMs` context convention.
2. Log and append that summary at both voice memo swallow sites, and carry the
   original error as `cause`.
3. Pair `ELEVENLABS_TTS_MAX_TEXT_LENGTH` with `ELEVENLABS_TTS_TIMEOUT_MS` in the
   runtime that owns them, enforce the length there, and source the tool schema
   from the same constant.
4. Cover the failure classes and the length/timeout relationship with focused
   tests.

## State

Active.

## Notes

Prompted by a 2026-07-25 incident: three consecutive group-chat voice memos
failed and reported only `voice memo generation failed`. The ElevenLabs account
was healthy (voice reachable, quota at ~9%, no moderation rejection, no recorded
generation attempt), so the requests died before generation, but the responsible
status was destroyed at the swallow site and never logged. The root cause of
that specific outage remains unattributable because no evidence of it survives;
this change makes the next occurrence attributable.

Measured on 2026-07-25, eleven_v3 synthesizes at roughly 25ms per character
(300 chars 8.6s, 600 chars 17.8s, 900 chars 23.0s). The previous 4000-character
schema against a 30s timeout made every memo longer than ~1100 characters a
guaranteed failure reported through that same opaque string.
Status: completed
Updated: 2026-07-25
Completed: 2026-07-25
