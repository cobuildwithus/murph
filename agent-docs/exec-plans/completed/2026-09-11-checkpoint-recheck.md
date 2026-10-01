# Skip redundant checkpoint scheduler rechecks

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Reduce facts-only scheduler traffic from intermediate checkpoints while preserving
changed deadlines, mailbox progress, due work, legacy behavior, and shutdown recovery.
Web owns checkpoint CAS and signaling; Temporal owns timers and accepted execution
horizons. A nullable acknowledgment on the existing workspace row is needed; no new
protocol field, cache, table, or facts query is needed.

## Evidence and design

The checkpoint callback signals whenever the resulting workspace has a wake or
retention deadline, without comparing the predecessor. Each recheck interrupts
Temporal's wait and reads reconciliation facts. Derive a conservative skip marker
from an acknowledged predecessor and successor inside the existing CAS statement. Compare all
wake projections, progress generation, and the complete redacted status so future
status consumers fail open. Ignore only snapshot/version/checkpoint timestamps.
Keep signals for legacy projections, due wakes, mailbox counter changes and shutdown.
A timestamp-only prototype was rejected: a failed first signal followed by an
unchanged checkpoint would otherwise delay an earlier deadline. Record a successful
signal against its exact workspace version after commit; carry that receipt only
across equivalent facts. Missing or failed acknowledgments keep retries eligible,
and late callbacks cannot acknowledge a newer version. Shutdown and the accepted
owner horizon retain their existing independent recovery roles. Conflicts never signal. This is an internal store result, not a wire change.

## Product UX (patch)

- Outcome: lower overhead with the same scheduled delivery and recovery behavior.
- Reaches: established and legacy runtimes, earlier assistant/retention deadlines,
  mailbox progress, concurrent checkpoints, failed recheck followed by shutdown.
- Proof: real PostgreSQL predecessor/CAS cases plus callback signal assertions;
  existing Temporal earlier-deadline and accepted-owner tests remain relevant.

## Scope and proof

1. Add failing database and route regressions for unchanged intermediate checkpoints.
2. Derive the skip decision atomically; retain conservative recovery signals.
3. Run checkpoint PostgreSQL, store and route tests, Web typecheck and complexity diff.
4. Parent review, update owner contract, close plan, open PR and run ReviewGPT with CI.

No provider-fetch optimization, production mutation, or public API change. The
additive nullable receipt column must migrate before Web; old Web remains supported.
The receipt has no TTL and never becomes scheduling authority. A successful signal
adds one bounded receipt write; skipped signals add no query or external request.
No public changelog: internal request suppression with no intended member-visible change.

## Verification and disposition

- Before-change proof: both the route suppression assertion and real PostgreSQL
  repeated-checkpoint assertion failed on the original behavior.
- Final focused proof: 144 tests passed across hosted-workspace-checkpoint-postgres,
  hosted-runtime-internal-routes and hosted-workspace-store. PostgreSQL ran in an
  isolated local database with the actual additive migration applied.
- Web typecheck passed: `pnpm --dir apps/web typecheck`.
- `pnpm complexity:diff` passed. The pre-existing checkpoint transaction hotspot
  remains 49; the pure skip projection keeps its recovery policy independently
  readable without splitting the existing atomic transaction owner.
- Parent review: exact-version acknowledgment preserves checkpoint timestamps;
  changed or unacknowledged facts retry; concurrent CAS losers cannot acknowledge
  successors; mailbox advancement clears receipts atomically. No private evidence
  or identifiers are included. No new reusable scheduler or cache was introduced.
- PR candidate is ready for required ReviewGPT and exact-head CI. Merge and rollout
  are outside this PR-creation task. Production savings require post-deploy
  measurement; local proof establishes suppression, not fleet-wide volume.
Completed: 2026-09-11
