# Defer admission while runner completion is settling

Status: completed
Created: 2026-09-18

## Outcome and invariant

A successful health response is not proof that the runner can accept another
invocation. Preserve exclusive runner admission and the existing completion
callback/shutdown fence while returning busy readiness through the existing
cleanup-unsettled retry result.

## Evidence and owner

The protected reminder gate reproduced a busy HTTP 409 when the next wake
followed completed activation. The entrypoint sends its result before awaiting
the fallback completion receipt and keeps activeJobCount positive during that
receipt. Existing entrypoint tests prove this deliberate shutdown fence.
Worker readiness currently ignores that health field and can launch too early.

Moving the callback ahead of the result is unsafe: completion cleanup can need
the lifecycle lock held by the invocation whose result is still pending. Keep
that ordering and fix admission at the existing readiness owner.

## Smallest correction and proof

- Carry the existing health busy observation through private readiness results.
- Return the existing cleanup-unsettled result while busy and do not cache a
  busy observation as reusable readiness. No new probe, timer, state, or retry.
- Reproduce warm/cold busy health, successful admission after settlement, and
  orchestration deferral without launch, retirement, or authority release.
- Run focused readiness/orchestration/entrypoint tests, typecheck, complexity,
  parent review, exact-head CI and ReviewGPT.
- Use protected Worker-only release with all gates and inspect live logs.

## Candidate evidence

Both warm/cold regressions failed on the base: positive active-job counts were
reported ready. The corrected focused suite passes 338 tests, including
completion-on-disconnect, shutdown drain, readiness caching, and orchestration
deferral. Cloudflare typecheck, docs drift, and whitespace checks pass. Complexity
debt stays 68; existing lifecycle hotspots remain unchanged.

Product UX: Patch, Ready. Busy health defers through the existing retry response
without launching, destroying, or releasing the target. Ordinary idle readiness
and fatal health validation keep their existing paths. The container-ready log
adds only a derived busy flag. Parent review found no new network call, durable
state, timeout, or protocol requirement; older runners already expose the count.
Exact-head CI, ReviewGPT, and the full protected reminder gate remain required
before production delivery; receipts will be recorded on the PR.
Updated: 2026-09-18
Completed: 2026-09-18
