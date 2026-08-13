# Page pooled database connection errors to operator phones

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Every observed pooled application connection-error delta reaches the existing independent operator phone-alert owner even while the primary Web database is refusing clients, without leaking query, credential, member, or route data.

## Success criteria

- A positive pooled-port provider connection-error delta, including the signal produced by a PgBouncer `max_client_conn` rejection, produces one durable, coalesced alert obligation and delivery to both configured operator destinations.
- Repeated failures coalesce without suppressing a later recurrence after recovery.
- Alert ingestion and persistence require no primary Postgres connection.
- Existing database-health paging, retry, acknowledgement, and telemetry-outage semantics remain intact.
- Focused tests, typecheck, ReviewGPT specialist/final gates, and required PR CI pass.

## Scope

- In scope: provider connection-error counters for direct port 5432 and pooled application port 6432; independent Cloudflare database-health persistence and phone delivery; bounded metadata-only evidence; deployment and monitoring documentation.
- Out of scope: increasing database limits, changing application retry authority, alerting on ordinary query/application errors, or making the alert path a database recovery owner.

## Constraints

- Technical constraints: the reporting path must survive primary-database exhaustion, preserve non-replayable counter evidence, pace pages, and add no database call to failure reporting.
- Product/process constraints: reuse the existing operator phone conversation and avoid copying confidential incident evidence into repository artifacts.

## Risks and mitigations

1. Risk: a per-failure bridge amplifies an outage into another request storm.
   Mitigation: prefer provider counters or a bounded coalescing owner and prove maximum event/page fanout.
2. Risk: counter reset or delayed delivery creates a false or lost page.
   Mitigation: retain the existing monotonic-series baseline, reset handling, durable owed-page, and recurrence tests.
3. Risk: alert text leaks driver or query detail.
   Mitigation: persist and render only allowlisted category/count/time metadata.

## Tasks

1. Inspect the exact Prisma classifier, PlanetScale pooled-port metrics, and Cloudflare database-health lifecycle.
2. Have ReviewGPT select and implement the smallest independent durable signal path with focused tests and docs.
3. Inspect the patch, verify failure/recovery/coalescing/privacy behavior, and remediate findings.
4. Push the exact candidate, run specialist and final ReviewGPT gates with CI, and open the PR.

## Decisions

- The alert owner remains the Cloudflare database-health singleton; Postgres cannot be the signal store because this alert specifically covers its admission failure.
- Scope is exact connection admission/limit rejection, not every SQL failure.

## Verification

- Commands to run: focused Cloudflare database-health and Web Prisma classifier tests; affected package typechecks; `git diff --check`; required exact-head CI.
- Expected outcomes: one durable two-destination page for a new rejection window, no page replay on unchanged/reset counters, no secret-bearing metadata, and a later recovered recurrence pages again.
