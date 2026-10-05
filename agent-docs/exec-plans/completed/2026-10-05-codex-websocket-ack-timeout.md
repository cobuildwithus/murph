# Bound unacknowledged Codex websocket requests

Status: completed
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

- Codex: `just test -p codex-api -E 'test(/responses_websocket/)'` passed 14,
  including 3 new acknowledgement tests. The new core reuse test and the existing
  reuse/fallback suites passed 8, and the core test fails before the 120-second
  idle timeout. A mutation check that disabled the bound failed both new failure
  tests. `just clippy -p codex-api` is clean.
- Patched-binary stall proof: a silent reused socket with a 90-second idle
  window recovered in 15,009 ms through one HTTPS replay. A response silent for
  18 seconds after acknowledgement completed on the websocket. The existing
  stall and idle-safety cases are unchanged on both binaries.
- Live local-subscription probe (uncommitted build): first provider frames
  arrived in 187-357 ms. That includes remote v2 compaction (357 ms, compacted
  in 8.1 seconds) and local compaction (6.0 seconds), with no fallback.
- Murph: `verify:codex-upstream-source`, Cloudflare contract tests (79), runtime
  events and config tests (131), assistant-engine transport tests (62),
  changelog page test (10), both typechecks, complexity diff (no change), and
  the docs drift check passed.
- Final ReviewGPT round 1 at `ca048ce3cf`: PASS. The first attempt was INVALID
  only because the snapshot lacked the native Codex owners; the same-head retry
  appended that verbatim source as prompt context.
Completed: 2026-10-05
