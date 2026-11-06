# Remove the log-triggered runtime recheck

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and ownership

The runtime log callback is diagnostic only. It authenticates, parses, writes and
answers. Failure recovery stays with its owners: `record_failure` before a stop,
the lifecycle alarm's settlement of a stopped failed invocation, and Temporal's
accepted-owner timeout for a lost hint.

## Scope and decisions

`runner.accepted_attempt_failed` has had no producer since 490acfd725 removed
`apps/cloudflare/src/user-runner/runtime-invocation.ts`. That file was Worker
code, so no retained container image can emit the event, and the private
repository has no producer either. The branch this change deletes could not run.

The event stays in the log vocabulary so historical rows keep parsing and Worker
protocol admission keeps comparing the same set. The cooldown column stays: old
Web and rollback builds still write it. Dropping it is a separate contract change.

## Proof and progress

- One route test sends two identical historical entries and proves they persist
  with no runtime signal.
- The stale-owner discard keeps its tests.
- The claim's unit and PostgreSQL tests went with the claim.

## Verification

Commands, counts and exit codes for the final head are in the PR body.

## Deployment

Web only, through production admission. No wire, schema, Worker, runner or
Temporal change.
