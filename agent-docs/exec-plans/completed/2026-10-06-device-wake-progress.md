# Transfer covered device schedule hints during import

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Outcome and invariant

A redundant scheduled device wake must not wait behind unrelated assistant work
when an existing retained connection operation already owns its schedule. Keep
foreground priority, dirty acknowledgements, checkpoint authority, and exact
connection epochs unchanged.

## Owner and evidence

The assistant runtime system mailbox owns imported work and retained device
continuations. Synthetic reproduction: a retained operation finishes a pass,
enters recording with a newer cadence, and receives an older scheduled hint
while completion publication is deferred. Import currently queues that duplicate
until post-checkpoint recording can run.

## Scope and approach

Transfer only covered plain scheduled hints at import under the existing runtime
write lock. Reuse canonical coverage and validated continuation projection. Keep
the recording owner and its completion record unchanged in the same snapshot.
Do not retire manual, dirty, differently bound, or unproven work. No new state,
provider calls, alert suppression, schema change, or deployment.

## Verification

- Add a failing synthetic import regression, including recording/restored owners.
- Prove negative identity/cadence/work boundaries and checkpoint rollback.
- Run focused runtime tests, package typecheck, diff checks, complexity review.
- Review and commit the scoped change; report production rollout separately.

## Results

- Reproduced redundant schedule retention in both pending and recording states
  before the fix. Import now transfers only coverage proven by the existing
  continuation and cadence rules, retaining the exact recording record.
- Focused notification, coverage, empty-mailbox, and checkpoint suites: 285
  passing tests, including 23 import boundary cases and accepted/rejected
  checkpoint replay. Package typecheck and complexity diff passed.
- The broader workspace system-mailbox suite has 78 passing tests and six
  failures on unchanged base 1d8c8762af9e as well as this patch. The daily-metric
  projection and five dirty-ack follow-up fixture failures are recorded in the
  task-owned Frog entry. This is an existing validation gap, not a green suite.
- Parent review: no provider calls, new persisted state, scheduling change,
  acknowledgement bypass, or alert suppression. Source complexity debt is
  unchanged. No member-facing changelog: internal mailbox ownership correction.
- Production mutation and rollout are outside this local fix. Existing work
  recovered independently; recurrence prevention needs the ordinary runner release.
Completed: 2026-10-06
