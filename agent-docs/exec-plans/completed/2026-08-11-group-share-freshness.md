# Bound consented group-share freshness

## Goal

Prevent routine personal-runtime device-sync wakes from indefinitely starving
the existing consented vault-share projection offer, while preserving fresh
human-message priority and the current Web-owned share/control boundary.

## Proven production symptom

- A personal runtime had current wearable data while both active group step
  projections remained on an older snapshot.
- Runtime logs showed successful checkpoints followed by repeated pending
  `device-sync.wake` work. The projection refreshed only after the runtime
  eventually obtained a long enough idle window.
- The provider connection, device-sync dirty handoff, mailbox watermarks,
  grants, and group read path were healthy. The failing boundary is the
  personal runtime's best-effort outbound projection scheduling.

## Architecture constraints

- Foreground human input remains strictly higher priority than projection,
  device sync, and other maintenance work.
- Web remains the owner of active grants and encrypted group snapshots; the
  personal runtime remains the only reader of personal vault source data.
- Reuse the existing checkpoint and runtime-wake loop. Do not add another
  scheduler, queue, persisted freshness state, or group-side device-sync path.
- A projection must never expose source state that has not first passed the
  existing successful checkpoint boundary.
- Keep best-effort projection failure isolated from primary runtime work, but
  make repeated device-sync churn unable to starve a bounded refresh forever.

## Implementation

1. Ask Review GPT for the smallest maintainable patch and regression test,
   grounded in the production timeline and current runtime loop.
2. Inspect the returned patch as untrusted intent, reject new ownership or
   speculative abstractions, and apply only the minimal proven correction.
3. Add focused runtime coverage proving repeated device-sync wakes cannot
   starve an active post-checkpoint projection while fresh conversation input
   still preempts it.
4. Run the focused runtime tests and affected typecheck, then perform the
   required ReviewGPT completion gates on the exact pushed PR head.
5. Complete the parent review, close this plan, and commit the scoped result.

## Verification

- Focused regression reproduces the old repeated-wake starvation and proves a
  projection delivery occurs without weakening foreground priority.
- Existing vault-share cancellation, failed-checkpoint, mailbox-wake, and
  device-sync scheduling tests remain green.
- `@murphai/assistant-runtime` typecheck passes.
- Direct code-path review confirms no new persisted state, scheduler, queue,
  raw health-data logging, or group-runtime device sync was introduced.

Status: completed
Updated: 2026-08-11
Completed: 2026-08-11
