# Preserve shutdown checkpoints during runtime replacement

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Prevent a replacement runtime from revoking the outgoing attempt's lease
  while that exact attempt is publishing its shutdown checkpoint.
- Keep ordinary startup and deploy replacement latency unchanged.
- Correct the incident diagnosis and remove the unrelated rollout workaround.

## Success criteria

- Replacement preserves a fence only when the durable current snapshot-upload
  session belongs to the exact fenced attempt and lease generation.
- A matching session causes one-second retries only while its runtime-owned
  heartbeat is less than 10 seconds old and completion is absent; live
  checkpoints have no artificial deadline.
- Absent, mismatched, completed, and stale sessions add no wait; a dead runtime
  can defer replacement for the 10-second liveness window plus at most one
  additional retry interval (one second) after its final heartbeat.
- Successful foreground preemption bypasses checkpoint preservation and stops
  heartbeat liveness before detached snapshot-session cleanup.
- Snapshot-session start has one six-second total deadline, the first heartbeat
  begins immediately, and later serialized attempts keep a two-second
  start-to-start cadence.
- Existing production rollout defaults and the independent state-isolation
  preflight remain unchanged.
- Focused coordination tests, Cloudflare typecheck, and exact-head review pass;
  any unrelated base-branch CI blocker is proved and documented.

## Scope

- `UserRunner` runtime-fence replacement and snapshot-session ownership.
- Retry classification and timing.
- Focused runtime coordination tests.
- Hosted runtime continuity documentation.

## Constraints

- Reuse the existing durable snapshot-upload session as the only handoff state
  owner, with server-owned heartbeat and completion metadata.
- Do not add a blanket fence grace period or delay ordinary starts.
- Do not change rollout configuration or weaken independent deploy guards.
- Derive liveness from the publishing runtime rather than snapshot age, and
  keep both heartbeat failure recovery and replacement retries short.

## Tasks

1. [x] Reconstruct the alert chronology from control and runtime-log evidence.
2. [x] Disprove concurrent execution and identify the interrupted checkpoint.
3. [x] Revert the unrelated startup-fence behavior and false incident record.
4. [x] Restore the existing rollout defaults and state-isolation preflight.
5. [x] Preserve only the exact live checkpoint handoff during replacement.
6. [x] Run focused verification, exact-head ReviewGPT, and classify PR CI.
7. [x] Update the PR, close this plan, and hand off deployment checks.

## Verification log

- Incident runtime-log and control-plane chronology reconciled; no concurrent
  attempts were present.
- The interrupted attempt began its shutdown snapshot about 3.1 seconds before
  replacement was accepted; it never published that snapshot.
- Fleet snapshot completion distribution over 14 days: p50 3.253 seconds, p95
  7.781 seconds, p99 12.061 seconds, maximum 28.969 seconds.
- Focused Cloudflare tests: 509 passed, including a 29-second live handoff,
  stale-heartbeat replacement, completion-marker replacement, heartbeat route,
  foreground-preemption bypass, total start-handshake timeout, immediate and
  serialized heartbeat timing, heartbeat shutdown before stalled cleanup, and
  retry timing.
- Cloudflare package typecheck passed.
- ReviewGPT round four found the foreground-preemption priority inversion and
  the start/heartbeat timing inequality; both were reproduced and remediated.
- ReviewGPT round five audited the complete exact-head patch and passed with no
  qualifying findings; model verification confirmed GPT-5.6 Pro.
- Exact-head Cloudflare-adjacent release build/typecheck and assistant, CLI,
  and platform coverage jobs passed. Two `apps/web` jobs are blocked by
  unrelated current-base regressions: the viewport workflow runs a design-proof
  spec without its required output variable (the same workflow fails on
  `main`), and app verification has an outdated biomarker design-study copy
  assertion. This PR has no `apps/web` diff.
Completed: 2026-08-09
