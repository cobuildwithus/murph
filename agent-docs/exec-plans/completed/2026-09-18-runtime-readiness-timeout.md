# Preserve readiness cancellation identity

Status: completed
Created: 2026-09-18

## Outcome and invariant

Return deadline-cancelled container readiness through the existing timeout retry
path. Preserve exact runtime ownership, uncertain native starts, cleanup
settlement, fatal health checks, and all existing deadlines.

## Evidence and owner

The installed Containers SDK can reject a cancelled start or fetch with a plain
Error instead of the supplied AbortSignal reason. The readiness owner returns
that operation outcome after settlement, so orchestration cannot recognize its
TimeoutError and surfaces a route failure. Existing SDK proof confirms the
start helper replaces the cancellation reason.

## Smallest correction

At the existing startup and health transport awaits, prefer the associated
signal's reason when it has aborted. Preserve original failures while that
signal is live. Do not change successful health interpretation, state,
deadlines, capacity, retries, dependencies, or execution authority.

## Proof and completion

- Reproduce plain SDK errors after deadline cancellation at startup and health.
- Prove non-cancelled errors, fatal image checks, cleanup settlement, and
  uncertain-owner orchestration remain intact.
- Run focused Container/SDK/orchestration tests, Cloudflare typecheck,
  complexity and privacy checks, candidate review, exact-head CI and ReviewGPT.
- Merge and use the protected Worker-only release, then inspect bounded logs.
- Report external instance availability and unattributed socket failures as
  unresolved unless independent evidence proves their causes.

## Candidate evidence

- Both deadline regressions failed on the original implementation. The final
  container/orchestration suite passes 266 tests; installed SDK proof passes 13.
- Cloudflare typecheck, documentation drift, and diff whitespace checks pass.
- Complexity debt remains 68; existing lifecycle hotspots are unchanged.
- A local workerd Durable Object RPC probe using the production compatibility
  date preserves DOMException TimeoutError and Error identity at the caller.
- Product UX: Patch, Ready. Deadline cancellation follows the existing retry
  path; uncancelled transport failure and fatal health validation are preserved.
- Parent candidate review found no added state, network calls, permissions,
  timeout budget, or retry loop. Public-safe test-friction evidence is included.
- Exact-head CI, external review, protected release and post-release observation
  remain delivery gates; their receipts belong on the PR. External native
  availability and unattributed socket failures are not claimed resolved.
Updated: 2026-09-18
Completed: 2026-09-18
