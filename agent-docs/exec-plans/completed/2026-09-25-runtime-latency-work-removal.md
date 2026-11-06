# Remove redundant work from runtime latency paths

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome

Delete redundant work before adding mechanisms. Preserve live provider authority,
ordered retirement locks, canonical receipt publication, cleanup discoverability,
recovery deadlines and all existing runtime success paths. Ship the accumulated
latency fixes and diagnostics through a reviewed, verified PR.

## Evidence and decisions

Provider authorization performs an unlocked routing read before repeating that
same gate read under its required transaction lock. Return routing from the locked
owner operation and remove the first query. Preserve all three ordered locks and
credential checks; do not cache authority or replace locks with stale snapshots.

Status checkpoints retain the same snapshot. Publication and migration already
register snapshots; status-only publication introduces no resource or recovery
obligation. Preserve retirement validation and workspace CAS, but skip cleanup
record reads/writes when the complete normalized snapshot is unchanged. Changed
references still record both current and replaced resources under owner locks.

Earlier independent local-read overlap and typing handoff changes remain in scope,
as do request-local Worker and Web timing diagnostics. Do not claim that these
changes fix unproven platform scheduling/initialization delays.

## Verification and completion

Prove exact query elimination before/after, immutable recovery metadata, cleanup
after replacement/deletion, stale/retired rejection, and provider routing and
credential behavior. Run focused unit and real-Postgres tests plus relevant
runtime suites and typechecks. Review the candidate, changelog and privacy,
close this plan, create the PR, start ReviewGPT concurrently with CI, resolve
findings within the task authorization and merge once gates pass.

Product UX: faster processing with unchanged authorization, content and delivery
policy. Warm/cold text, attachment, cancelled input, status-only checkpoint,
changed archive, deleted member and retired runtime are the relevant journeys.

## Implementation evidence

- Provider authorization: a real-Postgres regression failed at four queries
  before the change and passes at three ordered locking queries afterward.
- Unchanged snapshots: focused regressions failed before the change and now
  prove zero cleanup-record reads or writes; real Postgres preserves the full
  orphan row, recovery deadline and canonical workspace progress.
- Focused verification passed: Web 184 tests, Postgres 53 tests, assistant
  runtime 186 tests and Worker 164 tests. Web, assistant-runtime and Worker
  typechecks passed. Complexity, logging, documentation and whitespace guards
  passed with no new complexity debt.
- Product UX: Ready. Composed tests cover staging, typing ownership, failure
  cleanup, cancellation, checkpoint progress, retirement and authorization.
  No assembled model-input or tool-selection surface changed.
- Parent review: retained existing lock order, live credential checks, snapshot
  retirement validation and changed-resource registration. No new service,
  dependency, configuration, durable state or network operation was added.
- Implementation is complete. PR CI, final ReviewGPT and authorized merge are
  subsequent external gates; production latency improvement remains unmeasured.
Completed: 2026-09-25
