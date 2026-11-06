# Stop storing the completion recheck bit in native receipts

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and ownership

A native receipt records attempt, generation and state. It no longer stores
`immediateRecheckRequested`, and the alarm and demand recovery paths no longer
rebuild it. Web already signals Temporal on every successful final release,
whatever the boolean says, so the stored value changed nothing.

## Scope and decisions

Web stopped forwarding the value in a9d6318e01. No Web source reads it apart from
the protocol probe, and Temporal's `runtime_owner_released` has no such field.

This is the safe part of the removal. Three things stay:

- The `immediate_recheck` SQLite column. Older controllers select it, and a
  destructive SQLite change needs its own contract release.
- The required boolean on `complete`, and the protocol witness. Web's parser and
  live admission still demand them, so the Worker sends a constant `false`.
- `result` on the `recordSupervisedRuntimeCompletion` RPC. A controller that has
  not converged still reads it.

The runner's invocation-local wake and checkpoint decisions are unchanged. Its
result field now has no production reader, so removing it is a later runner change.

## Proof and progress

- On the real receipt store, a row written by an older controller with
  `immediate_recheck = 1` reads, completes and re-registers. A raw select of the
  column still succeeds on old and new tables, and the code never changes its value.
- A child result carrying `true` still produces `false` on the early and settled
  commands.
- Web's route and PostgreSQL tests are unchanged and keep proving that historical
  `true` and `false` are accepted and do not affect the hint.

## Verification

Commands, counts and exit codes for the final head are in the PR body.

## Deployment

Worker only. No Web, runner image, Temporal or SQLite migration step.
