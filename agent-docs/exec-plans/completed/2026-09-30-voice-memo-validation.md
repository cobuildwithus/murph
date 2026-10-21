# Validate generated voice memo audio before upload

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Reject generated audio that cannot produce decoded samples before attachment upload,
and surface zero-duration provider metadata without duplicating accepted messages.

## Product UX

- Outcome: unusable generated audio fails through existing generation failure handling.
- Reaches: generated speech and music on iMessage and Telegram, direct and group routes.
- Proof: real synthetic MP3 fixtures, provider-shaped HTTP responses, no-upload checks,
  cancellation, and accepted-send call counts. Device playback remains external proof.

## Scope and decisions

Use the existing shared ElevenLabs generation and Linq response owners. Decode with
an exact registry dependency instead of maintaining a partial MPEG parser or adding
an external native binary requirement. Process 64 KiB chunks and discard PCM.
Preserve encoded bytes and existing provider request counts. Zero-duration Linq
responses remain accepted and emit metadata-only diagnostics; they do not authorize
another send. No model inputs, routing, recipient authority, or durable schemas change.

## Risks and mitigations

- Decoder startup and CPU: lazy load only for generated audio; measure cold and warm
  validation and retain byte bounds, cancellation, and explicit decoder disposal.
- False rejection: test real mono speech, stereo music, and streaming MP3 without Xing.
- Duplicate delivery: zero/missing duration preserves accepted receipt and one send.
- Version skew: shared public package change with no private adapter API change;
  deploy a new runner bundle to activate validation. Old runners retain old behavior. The private verifier needs a playable synthetic
  success fixture before building a runner with this validator.

## Tasks

1. Add decoded-sample validation and typed non-retryable failure.
2. Retain provider duration and expose a content-free zero-duration diagnostic.
3. Add synthetic fixtures and focused generation/delivery regressions.
4. Run focused tests, typechecks, complexity, parent review, then open the PR and
   start the routed final ReviewGPT and required CI.

## Verification

Focused provider tests: 117 passed. Assistant channel/tool regressions: 160
passed. Manual send report tests: 8 passed. Operator-config and assistant-engine
typechecks pass. Complexity guard passes; existing unchanged hotspots were reviewed.
Synthetic validation measured 23.5 ms cold, 4.3 ms warm, and 571 ms for a five-minute
7.2 MB music clip on the local test machine. Changelog rendering and final CI/review
are recorded in the PR.

The reproduction is synthetic; it does not establish the cause of any particular
previously delivered attachment. No live delivery calls were made.
Completed: 2026-09-30
