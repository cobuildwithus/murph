# Expire operator task results after two days

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Outcome and scope

Operator diagnostic results expire 48 hours after completion. The Ops list
returns no expired result, and the existing hourly control-plane retention job
clears its ciphertext. Task audit/status and idempotency records remain intact.
Request admission, ten-minute execution expiry, and member delivery are unchanged.

## Evidence and design

The list currently decrypts every stored result without a completion-age check;
control-plane retention never clears hosted_operator_task.result_encrypted.
Reuse completed_at as the retention clock, share one retention constant, and
extend the existing serial bounded cleanup. Add a partial completed_at/id index
for rows retaining ciphertext. No new state, scheduler, or dependency.

## Product UX

- Outcome: private operator results disappear after two days.
- Reaches: recent results remain readable; boundary/older results return null,
  including before cleanup or during cleanup failure; active tasks stay intact.
- Proof: exercise actual listing with synthetic crypto and real PostgreSQL
  cleanup, including exact cutoff, recent results, running tasks, repeated cleanup,
  and retained audit/idempotency identity. No presentation change.

## Deployment and load

Additive index can deploy before Web; old and new versions share the same schema.
New readers suppress expired content before the first cleanup. Cleanup uses at
most two serial statements of 250 rows, one connection per statement, no external
calls or crypto under locks. Deletion is irreversible; reverting cannot restore
cleared results. Historical backlog drains on subsequent hourly runs.

## Tasks

1. Implement read expiry and bounded ciphertext retirement with partial index.
2. Add focused listing, cleanup orchestration, and PostgreSQL boundary proof.
3. Run tests, Web typecheck, complexity guard; inspect diff and scoped commit.

## Verification

- Focused Web Vitest: 19 tests passed across operator result read/retention,
  control-plane cleanup, cron routes, and Ops admission routes. PostgreSQL proof
  enabled against a local test database, using a connection-private temporary
  table built from the real task migration and applying the new index migration.
- Exact 48-hour cutoff, recent ciphertext preservation, running tasks, complete
  audit-row preservation, repeat cleanup, and 501-row backlog (500 then 1) passed.
- Web typecheck and complexity guard passed. The existing message-control
  complexity hotspot (21) is unchanged and outside the result-retention path.
- Product UX: Ready for the selected read/refresh and retention boundaries;
  existing browser state refresh behavior remains unchanged.
- Parent review: shared cutoff, existing cron wiring, row locking, index,
  idempotency preservation, privacy, and additive deployment shape inspected.
- No production mutation or deployment. Exact-head CI and routed ReviewGPT
  remain PR-stage gates; this task delivers a local scoped commit.
- Changelog not applicable: internal operator diagnostics only.
Completed: 2026-09-05
