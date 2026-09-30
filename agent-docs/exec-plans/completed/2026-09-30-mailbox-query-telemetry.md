# Separate mailbox database startup and query latency

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Distinguish platform startup, Prisma preparation, connection acquisition, and
PostgreSQL round trips without changing admission, SQL, retry, or reply behavior.

## Evidence and architecture

The incident request has no retrievable Vercel trace. Project configuration had
no sampling rules. Existing request-local operation and pool timers cannot split
client preparation from a query round trip; database-side Insights cannot measure
that client boundary. Reuse Vercel's infrastructure tracing and the existing
AsyncLocalStorage collector. Instrument the public pg client query boundary,
including transaction statements, without inspecting SQL, parameters, or results.
Prisma query-event logging was rejected because it serializes query parameters
on every query. No SDK, dependency, service, persistence, or additional I/O.

## Scope and invariants

- Add bounded content-free query timings to existing mailbox diagnostic records.
- Use a shared monotonic origin to compare operation, checkout, and query starts.
- Preserve pg callback and promise results, receivers, errors, and release behavior.
- Production tracing targets only the fixed mailbox-fetch path; no application
  headers, bodies, SQL, or query arguments are added to telemetry.
- Existing first/slow/failed logging policy remains. No user-visible change.
- Additive log fields require no coordinated deployment or database migration.

## Tasks

1. Verify native Vercel trace configuration and retrieve a synthetic request trace.
2. Extend existing pool/operation timing owner and mailbox record only.
3. Prove real PostgreSQL cold acquisition, queued checkout, query delay, errors,
   transaction statements, and overlapping request isolation; run Web typecheck.
4. Review privacy and complexity, close the plan, commit, and follow normal PR,
   review, CI, and managed production deployment under existing authorization.

## Verification

- Native project tracing verified with `destination: internal`, production-only,
  100% sampling on the fixed mailbox-fetch path. A synthetic unauthenticated
  request produced routing, function-invocation, response, and waitUntil spans;
  subsequent natural traffic is also captured. The current CLI's set command
  omitted the destination its list command requires; used the documented project
  API field and read back both API and CLI results.
- 109 focused tests passed, including four real PostgreSQL scenarios for cold
  acquisition, queued checkout, delayed SQL, SQL errors, transaction statements,
  and concurrent request attribution. The queued proof initially failed because
  pg dispatches a waiting query from the releasing request's context; binding the
  existing checkout callback to its requesting context fixes that attribution.
  The reverse case also reproduced: untraced waiters must restore an absent
  collector to avoid appearing in the traced releasing request.
- Final Web typecheck, complexity guard, diff whitespace, and docs drift passed.
  Existing failure-classification hotspot remains unchanged at 24; unrelated
  classification behavior is outside this diagnostic change. Parent candidate
  review found no remaining privacy, ownership, or scope issue. PR review, CI,
  and deployment continue as separate gates.
- Privacy review: existing hosting provider, fixed path, no new SDK or destination;
  native trace attributes inspected for synthetic and natural requests. Application
  diagnostics contain only numeric timings, fixed operation names, pool counts,
  and booleans. No SQL/parameter serialization, additional DB work, or provider I/O.
- Internal-only diagnostics: no changelog or product journey change.
Completed: 2026-09-30
