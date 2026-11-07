# Lost native invocation result recovery

## Outcome and protected invariant

Release a completed runtime owner without requiring another inbound message,
while retaining authority whenever native execution is active or uncertain.
Postgres owns admission; the bound container owns durable invocation receipts
and native liveness. No new state, timer, protocol, or scheduler is needed.

## Evidence and correction

A container callback marks the owner retiring. If its outer result is lost and
mailbox work has drained, orchestration can go idle without a processing call
that releases the owner. The lifecycle alarm currently preserves every retiring
owner, including an exact completed receipt with inactive native execution.
Extend that existing lifecycle reconciliation to replay settled completion only
for the exact receipt, owner identity and inactive native fence. Defer destruction
to a fresh lifecycle observation so concurrent successors remain protected.

## Product UX

Outcome: completed conversations do not retain stale runtime ownership.
Reaches: normal completion, lost outer results, and concurrent next messages.
Proof: deterministic native lifecycle tests plus the Linq composed scenario.

## Verification plan

- Prove the new lost-result lifecycle regression fails before the change.
- Cover active/unknown liveness, stale receipts, failed completion, successor
  races, and reactivation with durable SQLite evidence.
- Run focused Cloudflare tests and typecheck.
- Attempt three locked local Linq e2e runs with the private Temporal worker.
- Review diff, run complexity and documentation checks, then commit locally.

## Boundaries

No pushes, PRs, deployments, production access, or changes to existing checkouts.
No public/private protocol or database schema changes. Old adapters retain the
existing wake-driven recovery behavior; the change is safe for warm containers.

## Results

Implemented recovery in the existing lifecycle owner and replaced the e2e's
fixed shell sleep with a provider tool-call barrier released only after fault
injection and second-message admission. Every existing delivery, tool-output,
mailbox, fence-clearance and fresh-wake assertion remains.

The pre-change lifecycle regression failed in both live and reactivated cases
(`retiring` instead of `idle`). Final focused verification passes:
294 tests across lifecycle, standby, completion, processing, runtime callback,
and provider-stub owners; Cloudflare typecheck; docs drift and gardening;
complexity guard. The final native-health lifecycle rerun passed all 47 tests.
Existing complexity hotspots are unchanged. Bundle assembly also passed.

Local composed verification could not start: the shared e2e lock remained held
for approximately 20 minutes of 30-second acquisition retries. Only this task's
proven childless lock waiter was interrupted, before lock acquisition; the other
investigator's lock and processes were untouched. Zero local e2e passes and no
native 2-vCPU load reproduction are claimed. The private checkout has no source
edits. Product UX composed replay remains Hold pending the private CI scenario;
the focused lifecycle, concurrency and provider barrier proof is complete.

Changelog: internal ownership/resource cleanup and deterministic proof; ordinary
incoming-message recovery already re-admits through the existing processing
path. No new messaging behavior or member-facing feature is introduced.
No changelog entry is warranted for this scoped correction.

Parent review checks exact attempt/generation/target, native liveness, failure
preservation and successor safety. External pushed-head review and CI are outside
the explicitly local-only scope.
Status: completed
Updated: 2026-10-06
Completed: 2026-10-06
