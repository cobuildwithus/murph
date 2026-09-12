# Preserve database monitor progress across repeated scheduled checks

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and evidence

Review round 2 identified a mismatch between the per-invocation failure counter
and samples upserted by scheduled timestamp. Repeating a completed slot can
advance the counter without adding evidence, then repeatedly throw at the
six-check threshold before sampling or pressure admission can commit.

## Implementation and protected behavior

Reuse the newest persisted sample as the completed scheduling boundary. After
claiming the existing run lease, a repeated or older slot resumes only delivery
handling using the newest sample; it does not recollect, overwrite evidence,
advance counters, or readmit conditions. Fresh slots retain ordinary collection
and transactional admission. Pending delivery keeps its existing body, key,
recipient checks, and hourly fence. No new schema, queue, or state owner.

## Product UX and proof

Operator outcome: six distinct failed checks produce truthful telemetry evidence,
and available concrete pressure remains deliverable across restart and replay.
Prove repeated first failure, older replay after later progress, restart before
the threshold, pressure during incomplete telemetry, and ambiguous delivery
retry at the same scheduled timestamp. Replay after recovery must use the newest
healthy evidence. Member conversation behavior is unchanged.

## Tasks

1. Reproduce duplicate-slot counter drift with the real monitor and SQLite.
2. Add the smallest replay guard and scheduled Durable Object proof.
3. Update the monitoring owner docs; run focused tests, typecheck and complexity.
4. Review and commit the correction, update the PR, and run final round 3 with CI.

## Deployment and verification

Existing sample and metadata shapes remain unchanged. Worker-only policy update;
no Web or container coordination or migration. Reversal restores prior replay
behavior. No production deployment is authorized here.

Local proof passes: 141 focused monitor/metrics/store/Worker-routing tests and
6 real workerd Durable Object tests, Cloudflare typecheck, `pnpm complexity:diff`,
and `git diff --check`. Both new replay variants failed before the guard and pass
afterward. The scheduled Durable Object proof also repeats a completed failed
slot and verifies unchanged request counts, samples, and failure count.
Parent review confirms one bounded latest-sample read per run, no new provider
calls or state, unchanged admission transaction, and unchanged complexity debt.
Product UX: Ready for external review. Final round 3 and exact-head CI remain
pending; neither merge-readiness nor production rollout is claimed.
Completed: 2026-09-12
