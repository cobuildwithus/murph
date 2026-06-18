# PR 212 ReviewGPT Round 1 Fixes

## Goal

Fix the accepted ReviewGPT round 1 findings for PR 212 without broadening the
voice memo architecture.

Success means hosted voice memo generation can upload Linq presigned
attachments through the validated public upload path, ElevenLabs egress only
forwards the narrow generated TTS request shape, voice memo media cannot enter
the delivery pipeline without a Linq attachment id, tests prove those seams, and
the PR branch is pushed for the next ReviewGPT round.

## Constraints

- Keep the voice memo delivery architecture Linq-native only for this PR.
- Do not add a general public voice memo URL delivery path.
- Do not route raw presigned upload fetches through provider egress.
- Keep ElevenLabs credential injection bounded to the runtime-generated request
  shape.

## Plan

1. Split voice memo fetch dependencies so the raw presigned upload can use a
   public fetch after Linq upload URL validation.
2. Validate and rebuild ElevenLabs TTS bodies before injecting the Worker-held
   credential.
3. Collapse voice memo media to require `transportRefs.linq.attachmentId`.
4. Add focused regression tests and rerun scoped verification.
5. Commit, push, and rerun the PR deep-review loop.

## State

Active.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
