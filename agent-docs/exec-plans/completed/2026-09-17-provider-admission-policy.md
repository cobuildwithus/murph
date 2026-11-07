# Runtime admission policy simplification

## Outcome and boundaries

Access, suspension, and health-data consent are checked at runtime claim admission.
Admitted work may finish after account policy changes. Existing retirement still
ends authority. Preserve exact caller identity, generation and write ownership,
provider operation policy, and managed spending enforcement.

## Existing owners and deletion

Web runtime-owner claim owns admission. Remove duplicate policy reads from
runtime ownership and provider validation. Use the provider authorization response
for backend selection instead of a separate Worker-to-Web reconcile request.
Keep the finite legacy bridge and fail closed for draining or stale owners.
No new state, configuration, credentials, dependencies, or services.

## Proof and deployment

- PostgreSQL: revoke consent, suspend, or pause billing after claim; the admitted
  owner remains usable, new claims fail, and retirement still rejects stale work.
- Worker: one authorization command for provider requests; explicit legacy routing,
  no draining/stale fallback, wrong credentials rejected, denied usage preserved.
- Run focused tests, affected app typechecks, diff and complexity review.
- No schema or command-shape change. Deploy Web before Worker: the new Worker
  relies on Web returning explicit legacy routing for exact-header authorization.
  Existing Worker remains compatible with new Web. An older Web remains stricter
  for Postgres account policy. No deployment authorized in this task.

## Progress

Implemented at the existing Web owner and Worker provider boundaries. Account
existence remains checked because deleted accounts retain cleanup-only owner rows.
No assistant prompt, tool contract, or model decision behavior changed.

Verification:
- Cloudflare provider/settlement suites: 277 passed.
- Isolated loopback PostgreSQL ownership suite: 37 passed; changelog fragments: 7 passed.
- Cloudflare and Web typechecks passed.
- Docs drift, diff whitespace, and complexity checks passed. Existing interceptor
  hotspots are unchanged; no new hotspot was introduced.
- Parent review: Ready for the synthetic admitted-run, blocked-next-run, stale
  owner, deleted-account, typing, native credential, and denied-spend journeys.
  No live delivery or production latency measurement was performed.
- Changelog: 2026-09-17 / less-wait-before-typing. Local change only; source PR
  attribution is empty until a PR exists.
- Final ReviewGPT and exact-head CI belong to the subsequent PR lane and have not
  run. No push, PR, merge, or deployment was requested or performed.

Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
