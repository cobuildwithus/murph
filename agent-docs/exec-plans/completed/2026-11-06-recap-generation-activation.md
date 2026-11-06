# Recap generation activation

Status: completed

Outcome: stale published recap work terminates without delivery and permits a
clean regeneration. Settled results, tickets, story storage and read rules stay
with their existing owners.

Gate: the runner image with the #4653 terminal consumer must be live before this
Web activation merges. An older runner retries terminal work forever. Retain
that consumer as the runner rollback floor.

Gate check: the runtime deploy of a11176c086, which contains #4653, reports the
Worker at 100%, RunnerContainer rollout completed on the image the smoke runner
passed on, and verified live release convergence. SmallRunnerContainer is excluded
from rollout by design and keeps an image from before #4653, so a runtime still
bound to a runner-small target has no consumer. A stale item there keeps today's
retry, which is no worse than before this change, and it does not block a clean
regeneration. Whether any game room is bound there is unknown here.

Implementation: keep the witness check pure; use the existing delivery receipt
for retirement under the game lock. Read the durable reason after runtime
authorization and before roster work. Dry runs only inspect; execution retires
before reserving. Claimed provider work and temporary failures stay uncertain.
No schema, wire, package, ciphertext-handling or view-rule changes.

Proof: real PostgreSQL, publication, takedown, recap tool and dispatch fence,
with synthetic runtime and roster boundaries. Cover all three takedown timings,
lazy report/legacy retirement, final-seal races, clean successors, uncertainty,
exact reason, unpublished work and dry runs. Preserve the reporter's existing
view suppression while proving the clean story is visible to the nonreporter.

Before implementation, the corrected 62-test witness suite exited 1: nine new
proofs failed. Three takedown timings left skippedAt null; pair-report and legacy
reads, final-seal retirement and report recovery returned the old unavailable
value; removed/report-stale previews returned delivery_pending/recap_unavailable.
The other 53 tests passed, including all negative controls. An earlier fixture
run also exposed a missing synthetic public origin, corrected before this proof.

The replay-seal edge also failed first (exit 1): it retired the receipt but
returned a validation rejection. Rechecking retirement immediately after replay
now returns the terminal value before validation or another roster read.

Verification: each requested file ran separately against the isolated local test
database with MURPH_TEST_POSTGRES_CONCURRENCY=1 and no coverage. All exited 0:
witness 64, late recap 15, chat tool 43, lifecycle 57, delivery authority 18,
egress engagement 173, report/block 36, service 75, groups 140, Ops recap 11.
The existing old-Web skew test was skipped because its separate opt-in flag was
not requested. No orphan-receipt cleanup was needed; test-generated metrics were
removed. Affected suites passed again after the final simplification.

Prepared Web typecheck with MURPH_TSC_WEB_CHECKERS=1 exited 0. Complexity initially
exited 1; consolidating duplicate terminal responses and the previous-generation
eligibility checks brought it to 0 with no hotspots. Docs drift
reads committed state, so it runs after the commit.

UX: Ready for the tested Web boundaries: stale work terminates, clean successors
publish, temporary failure and provider uncertainty remain recoverable, and
results/tickets remain identical. Production activation stays gated.
This change activates the existing deterministic host protocol; model prompts and
package journeys remain unchanged. Runner consumption itself was introduced in
#4653 and is outside this Web-only proof. No separate public changelog: this is
protocol activation with a deployment gate, not a new member-facing surface.
Updated: 2026-11-06
Completed: 2026-11-06
