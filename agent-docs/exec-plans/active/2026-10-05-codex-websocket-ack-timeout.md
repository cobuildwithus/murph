# Bound unacknowledged Codex websocket requests

Status: active
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- A member reply must not wait for the 90-second native stream idle timeout
  when a reused Responses websocket silently drops a request. Native compaction
  keeps its 90-second window after the provider acknowledges the request.

## Evidence

- A production direct-message reply on 2026-10-05 was delivered after about 102
  seconds. Runtime logs showed a warm-reused websocket, a `websocket-read` idle
  timeout after 90.2 seconds with no provider frame, then native HTTPS fallback
  that answered in about five seconds. No Worker deploy occurred in the window.
- Over the prior 14 days, one of roughly 190 reused-websocket turns stalled;
  reuse after 100 seconds or more of idleness otherwise succeeded, so no fixed
  intermediary idle cutoff explains it.
- Pinned Codex 0.160.0 and current upstream reuse a cached socket after only an
  `is_closed()` check, send no client pings, and apply the full stream idle
  timeout to the first read after `response.create`. #3661 restored 90 seconds
  because remote compaction can be silent after acknowledgement.

## Success criteria

- The deployed Codex patch fails an unacknowledged websocket request after 15
  seconds when that is stricter than the provider idle timeout; later frames keep
  the idle timeout.
- Existing native fallback completes the turn over HTTPS and the next turn.
- An acknowledged response that is silent beyond 15 seconds still completes on
  the websocket.
- Hosted diagnostics classify the new timeout as `websocket-ack`.

## Scope

- In scope: Codex patch, upstream Codex tests, transport diagnostic
  classification, deployed-binary proof in the sandbox lane, runtime-log docs.
- Out of scope: Codex config knobs, client keepalive pings, retry-count changes,
  and diagnosing the unobserved intermediary that dropped the socket.

## Risks and mitigations

1. Risk: A healthy provider takes longer than 15 seconds to send its first frame.
   Mitigation: Any frame counts; failure only replays the unacknowledged request
   through the existing HTTPS fallback. Measure live first-frame latency.
2. Risk: The patch drifts from the reviewed upstream base.
   Mitigation: Regenerate the single patch from the pinned tag and verify
   applicability with the existing source verifier.

## Tasks

1. Implement and test the acknowledgement bound in a pinned-base Codex worktree.
2. Regenerate `patches/codex-public-live.patch` and update its owner docs.
3. Classify the new timeout phase in assistant-engine and runtime diagnostics.
4. Prove fallback, compaction-style silence, and the next turn against the
   patched binary; add the proof to the deployed-binary CI step.
5. Review, commit, open the PR, and complete the review loop.

## Decisions

- Use a constant in Codex instead of a provider config field to avoid a
  twenty-file config surface and Murph config skew with the npm helper binary.

## Verification

- Commands to run: focused Codex `just test` filters, `verify:codex-upstream-source`,
  assistant-engine stall tests with `MURPH_TEST_CODEX_COMMAND`, focused
  diagnostics tests, and typechecks.
- Expected outcomes: all pass; recovery at about 15 seconds instead of 90.
