# Preserve shutdown checkpoints during runtime replacement

Status: active
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
- A matching session causes one-second retries for no more than 15 seconds from
  session creation; absent, mismatched, and stale sessions add no wait.
- Existing production rollout defaults and the independent state-isolation
  preflight remain unchanged.
- Focused coordination tests, Cloudflare typecheck, exact-head review, and PR CI
  pass.

## Scope

- `UserRunner` runtime-fence replacement and snapshot-session ownership.
- Retry classification and timing.
- Focused runtime coordination tests.
- Hosted runtime continuity documentation.

## Constraints

- Reuse the existing durable snapshot-upload session as the only handoff fact.
- Do not add a blanket fence grace period or delay ordinary starts.
- Do not change rollout configuration or weaken independent deploy guards.
- Bound stale-session impact while covering the measured p99, and keep retries
  fast enough for the normal publication path.

## Tasks

1. [x] Reconstruct the alert chronology from control and runtime-log evidence.
2. [x] Disprove concurrent execution and identify the interrupted checkpoint.
3. [x] Revert the unrelated startup-fence behavior and false incident record.
4. [x] Restore the existing rollout defaults and state-isolation preflight.
5. [ ] Preserve only the exact fresh checkpoint handoff during replacement.
6. [ ] Run focused verification, exact-head ReviewGPT, and PR CI.
7. [ ] Update the PR, close this plan, and hand off deployment checks.

## Verification log

- Incident runtime-log and control-plane chronology reconciled; no concurrent
  attempts were present.
- The interrupted attempt began its shutdown snapshot about 3.1 seconds before
  replacement was accepted; it never published that snapshot.
- Fleet snapshot completion distribution over 14 days: p50 3.253 seconds, p95
  7.781 seconds, p99 12.061 seconds, maximum 28.969 seconds.
- Focused runtime-coordination test: 128 passed.
- Retry-response tests: 2 passed.
- Cloudflare package typecheck passed.
