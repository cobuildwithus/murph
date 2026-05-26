# Junction REST Diagnostic

## Goal

Add a localhost/env-gated diagnostic path that can make a direct Junction REST resource call or bounded refresh call for the signed-in member's active Junction connection and return only redacted metadata: endpoint kind, resource, status/count, and response shape.

Success means a developer can test the Junction provider API end to end, force a current user-data refresh, and preserve real daily-data webhook payload jobs through the hosted handoff without exposing provider account identifiers, secrets, or raw response bodies in diagnostics.

## Scope

- Extend the Junction provider diagnostics with bounded REST resource and refresh probes.
- Wire the existing hosted settings backfill diagnostic route to call the probe through query params.
- Preserve already-sanitized Junction `daily.data.*` webhook job JSON through hosted dirty-resource handoff.
- Import non-empty `daily.data.*` payload records directly before REST fallback.
- Preserve explicit webhook windows for historical/resource jobs, and keep REST calls provider-scoped when the source provider is known.
- Map documented Junction timeseries slugs and normalize readable core timeseries values into compact observations.
- Add focused tests for safe call forwarding and sanitized provider output.

## Constraints

- Do not return raw Junction records, account ids, access material, webhook payloads, or direct provider identifiers from diagnostics.
- Keep the route authenticated and limited by the existing local/env diagnostic gate.
- Preserve existing backfill diagnostics behavior when the new probe params are absent.

## Verification

- Focused provider and hosted route tests.
- Typecheck / diff-aware verification as required by repo workflow, unless blocked by unrelated dirty work.
- Completion reviews for health-data diagnostics and external API surface changes.
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
