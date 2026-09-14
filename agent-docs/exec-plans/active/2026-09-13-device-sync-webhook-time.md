# Recover device hints with future source timestamps

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and invariant

Accepted plain device webhook hints must join the exact retained connection
owner even when a provider's event timestamp is ahead of the runtime clock.
Preserve canonical dirty state, connection authority, scheduled cadence,
exact retained jobs, retry deadlines, and foreground priority.

## Evidence and owner

The mailbox coverage predicate uses a source occurrence timestamp to reject
already-accepted webhook work. That same-connection barrier also blocks later
hints. Reproduce with synthetic future timestamps and saved retry state.
The existing system-mailbox coverage and runnable-selection owners are the
correction boundary; no new queue, persisted field, or provider policy is needed.

## Product UX

- Outcome: Connected-device updates can proceed despite source-clock skew.
- Reaches: Plain webhook notifications during a retained history retry, including
  checkpoint restore and later accepted notifications.
- Proof: Real mailbox persistence, selection, acknowledgement failure/retry,
  restore, and handling-frontier assertions with synthetic provider work.
  Provider collection and live recovery remain separate evidence.

## Tasks and proof

1. Add failing future-source-time cases to existing composed mailbox tests.
2. Remove source-time admission from webhook coverage and retained-owner
   selection; keep schedule and job retry authority.
3. Run focused mailbox tests, package typecheck, complexity and diff review.
4. Update the reliability owner and changelog, close this plan, and commit.

## Deployment and limits

The correction reads existing state without migration; old runners continue
the delay while new runners recover through ordinary admission. No production
mutation or manual mailbox acknowledgement is part of the local correction.
Production deployment and post-deploy canonical readback are still required.

## Verification results

- Before correction, both future-source-time cases failed immediate admission;
  the twelve existing drain scenarios passed.
- After correction, 216 focused mailbox/state/diagnostics cases pass. The final
  notification suite includes 160 cases, including future scheduled occurrence
  preservation, authority barriers, backoff, checkpoint restore, and retry.
- Assistant-runtime and Web typechecks pass.
- All ten changelog archive rendering tests pass. The documented package-cwd
  command found no files; the equivalent root-cwd invocation passed. This is
  already tracked by Frog's changelog focused-test entry.
- Complexity guard and diff whitespace checks pass. The existing unrelated
  record-parser hotspot remains at 25; no new state or abstraction was added.
- Parent Product UX replay: Ready for the model-free mailbox boundary. No model
  prompt, tool schema, interpretation, or reply behavior changes.
- Production recovery remains unverified until a corrected runner is deployed.
