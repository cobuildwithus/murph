# Preserve checkpoint-raced reply liveness

Status: active
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Remove the proven snapshot-completion and invocation-return races that can
  defer already-due assistant work by another recovery window, without adding
  a scheduler, queue, state owner, or recovery loop.

## Evidence boundary

- Production evidence proves that one canary reply spent about 375 seconds
  inside Murph before outbound dispatch. Linq accepted it about 148
  milliseconds after dispatch and delivered it about 1.3 seconds after
  dispatch, so Linq was not the source of the delay.
- Surviving timing is consistent with two roughly three-minute checkpoint
  windows. Canary cleanup removed the historical mailbox, workspace, latency,
  and runtime-attempt rows needed to attribute the exact production
  interleaving. Do not claim an instruction-level production cause that those
  retained facts cannot prove.
- A proposed foreground checkpoint shortcut was rejected and removed after
  review showed its decisive phase was synthetic and its predicate was broader
  than the causal wake. It is not part of this change.

## Success criteria

- The real Cloudflare snapshot port proves RED that a wake after an ambiguous
  `/complete` transport loss vetoes the one exact replay.
- A composed real runtime-entrypoint, snapshot-bridge, coalescing-wake, and
  fake-clock regression proves that losing the response after remote commit can
  add exactly one 180-second idle window before due assistant work runs.
- The snapshot heartbeat remains live through the exact replay even after the
  construction signal is aborted.
- The real coalescing wake signal proves RED that a wake accepted after the
  package's final drain is surfaced through the existing immediate-recheck
  result edge.
- Focused suites, adjacent controls, typechecks, and a hosted-local foreground
  reply journey run before handoff.

## Constraints

- Preserve checkpoint-before-continuation ordering and the routine idle floor.
- Keep one canonical `/complete` deadline, at most one identical replay, and
  existing terminal HTTP and payload-validation behavior.
- Reuse the existing coalesced wake and positive-only
  `immediateRecheckRequested` handoff.
- Add no dependency, persisted marker, manager, or feature-specific liveness
  state.

## Implementation

1. Snapshot completion no longer lets a queued wake veto the one exact,
   replay-safe disambiguation request after canonical publication has started.
2. Entering `/complete` transfers the existing heartbeat to the
   noninterruptible completion/replay lifetime and stops it in the existing
   completion `finally`.
3. When the package invocation settles, Cloudflare closes wake admission and
   drains the coalesced signal in the same synchronous turn. An already
   accepted wake sets the existing immediate-recheck result; later wakes are
   rejected to the outer reconciliation owner.

## Verification

- RED proof:
  - Exact completion transport loss plus a following wake failed without
    replay.
  - The same replay test failed without completion-owned heartbeat continuity:
    the heartbeat count remained unchanged after the wake.
  - A wake injected after the package's final drain was accepted but omitted
    from the returned handoff.
  - The composed checkpoint test measured one additional exact 180-second
    window after the remote commit on unchanged behavior.
- Current GREEN proof:
  - Cloudflare snapshot platform: 203/203.
  - Cloudflare invocation adapter: 11/11.
  - Assistant checkpoint races: 20/20.
  - Broader foreground-input, checkpoint-wake, collapse, and shutdown controls:
    80/80.
  - Assistant-runtime and Cloudflare typechecks pass.
- Hosted-local proof:
  - Foreground reply modes completed in 15.1 seconds, 2.4 seconds, 5.6
    seconds, and 11.0 seconds against a 30-second deadline and a configured
    180-second idle floor.
  - The overall multi-case command did not pass: three Environment-work cases
    reached an external Temporal protocol mismatch. The sibling worker resolves
    `@murphai/hosted-execution` 1.3.1, whose exact-key parser lacks the current
    1.3.2 system-progress fields returned by this checkout. This blocks a
    full-suite green result but is outside this diff; report it rather than
    weakening either contract.

## Remaining work

1. Run diff/privacy checks and the required completion reviews.
2. Commit the scoped change, open the PR, and complete the repository review
   gates.
