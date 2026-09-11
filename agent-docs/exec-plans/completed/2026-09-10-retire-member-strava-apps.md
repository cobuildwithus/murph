# Retire member-owned Strava applications

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and invariant

Remove the dormant member-owned provider-application foundation completely.
Keep ordinary configured Strava OAuth, refresh, polling, disconnect, device
imports, and all other providers. Preserve custom inference, Clinical Records,
and group referral missions.

## Ownership and evidence

The provisioning writer has no production caller. The supplied audit reports
no retained applications or bound connections/OAuth sessions; a fresh read-only production existence check also confirmed all three are absent. Existing static provider configuration
and shared ingress remain the authoritative supported connection path.

## Work and verification

Remove the encrypted application store, exact application bindings, registry
overlays, snapshot credential transport, cleanup branches, and dedicated tests.
Preserve OAuth owner checks, callback replay, token rotation, source fencing,
ordinary Strava cleanup, and account deletion proof. Run focused Web/runtime
tests, relevant typechecks, schema validation, and complexity review.

## Deployment

Deploy readers/writers that no longer reference the retired shape first.
After the existing Vercel drain and alias proof, a contract migration checks
that the application table and binding columns contain no retained authority,
then drops the columns and table. It fails closed if that assumption changes.
No production mutation or deployment is performed in this task. The first
deployment using the smaller shape becomes the rollback floor after cleanup.
Runtime snapshots omit the optional application override; static configuration
continues across old/new runtime combinations.

## Completion

Implementation, focused proof, and parent candidate review complete. Scoped commit, PR, exact-head CI, and ReviewGPT follow.


## Verification evidence

The contract migration passed on a session-owned disposable PostgreSQL database:
retained application rows and orphan revision bindings each refuse cleanup;
empty cleanup succeeds twice and preserves an ordinary connection. The test
database was removed afterward. No production mutation occurred.

Focused Web tests passed after obsolete application scenarios/mocks were removed:
376 tests in the rerun, plus four previously passing store/runtime/agent suites.
Assistant runtime: 169 focused tests plus five selected hosted runtime tests
passed. Device snapshot contract: 107 tests passed. Web, assistant-runtime,
and device-syncd typechecks passed; both affected packages built. The final
configured-provider test includes Strava and passed; final ingress cleanup
passed 199 webhook/wake tests. Complexity passed; retained hotspots either
shrink or preserve their pre-existing state-machine responsibility. No source
references to the retired application or binding symbols remain.

One package-script invocation expanded filename filters into the full suite.
That accidental run produced an unrelated vault-share failure before stopping;
only its exact task-owned process tree was signaled after command and cwd
ownership proof. The correctly filtered runtime proof above passed. This
broad-run observation is not claimed as a green acceptance suite.

Privacy and full diff review passed. No unused compatibility authority remains;
OAuth member locks/replay, token leases, health-data consent, and ordinary
source admission are retained. Required exact-head CI and ReviewGPT remain
external completion gates.
Completed: 2026-09-10
