# Classify Linq preparation retries without changing delivery

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and invariant

Distinguish existing direct Linq preparation failures using their already-owned
closed reason. Preserve all admission, retry, error, delivery, and privacy behavior.

## Owner and evidence

The direct Linq planner already produces six bounded preparation reasons. The
shared prepared transaction retry records only the error code, while failed
Linq timing records expose only the error class. Synthetic distinct reasons
therefore produce indistinguishable diagnostics. Existing logs suffice once the
closed reason is projected; no telemetry pipeline or state owner is needed.

## Scope and risks

Telemetry-only metadata on existing retry/failure records, focused synthetic
proof, and owner documentation. No raw error details, member/provider content,
extra log events, I/O, state, auth, schema, retry, or configuration changes.
Existing behavior and mixed-version operation must remain identical.

## Tasks and proof

1. ReviewGPT implements the bounded projection and focused regressions.
2. Parent inspects privacy, complexity, exact exception and retry preservation.
3. Run focused tests, Web typecheck, docs and complexity checks.
4. Commit, draft PR, final ReviewGPT concurrently with exact-head CI.
5. Merge/deploy only if telemetry-only gates and canonical compatibility permit;
   otherwise preserve the specific boundary and natural-traffic query.

## Deployment and observation

Web-only additive logs. Old/new readers and Worker/runtime combinations require
no protocol change. Query existing preparation retry and failed Linq timing
records by the new closed field after normal production deployment. Retain only
bounded aggregates; no synthetic production events or replay.

## Candidate evidence

ReviewGPT implemented the projection at the existing logging owner. The parent
verified the accepted turn, requested model, completion marker, and patch hash,
then inspected all source and proof changes. Parent-only test corrections keep
Next's deferred callbacks deferred and type malformed fixture values as unknown.

- Four focused Web suites pass: 279 tests covering logging, real Linq dispatch,
  root prewarming, and the route. The composed control-root retry and exhaustion
  scenarios fail against the old source specifically on the missing field;
  their unchanged successful counterpart passes before and after.
- Prepared Web typecheck, docs drift, and whitespace checks pass. Complexity
  guard passes with no added debt; the new projection is 12, and existing
  service hotspots and branch decisions are unchanged.
- No database or network call, await, event, retry, or identifier is added.
  Only the six fixed literals can reach the field. Error identity and exact
  one/two planning transactions, lock counts, append counts, and HTTP responses
  are covered. Existing success timings omit the field.
- Changelog and product journeys are not applicable: internal additive log
  metadata only; no prompt, tool, reply, or rendered UI changes.

## Final review and handoff

PR #3706 contains the telemetry-only candidate. Final ReviewGPT round 1 passed
on `e47d0cfa04a3a25e984a562408035cb62f059b18`, with the requested model and
exact response identity verified. There are no accepted or unresolved findings.
The parent confirmed the full production patch remains the reviewed projection
and four log-field additions; the closeout changes only this plan and its index.

The implementation is complete. Required CI must pass on the final authored head
before the telemetry-only merge. Canonical Git-managed Web deployment admission
and read-only natural-traffic observation remain separate release gates. No
functional correction, schema, configuration, provider action, or replay is
authorized by this plan. If no natural retry occurs, retain the bounded query for
the next sweep rather than generating production events.
Completed: 2026-09-25
