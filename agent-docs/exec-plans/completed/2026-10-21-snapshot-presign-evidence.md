# Attribute snapshot presign failures without private data

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Outcome and invariant

Make an existing snapshot-presign failure attributable to a finite failing stage
and the validated runtime attempt without retaining private data. Preserve the
exact error, HTTP response, admission, resource cleanup and replay behavior.

## Owner and source evidence

The runner outbound failure log records only a generic error class and operation.
Managed preparation, receipt validation, cleanup and signing can all fail with
the same class. Runtime-side upload phase diagnostics cannot locate this inner
Worker failure and are unavailable when the runtime attempt is interrupted.
The existing verified upload session already contains the runtime attempt.
Use those existing owners and the current structured logging pipeline; do not
add monitoring infrastructure, persisted state, request-body logging or retries.

## Scope and compatibility

Closed stage/reason and opaque existing attempt correlation only. Never log
member, snapshot, object/upload ids, paths, URLs, bytes, headers or error prose.
No provider behavior, schema, migration, new success-path I/O or deploy ordering.
The earlier runtime upload-phase patch covers another boundary and stays intact.

## Tasks

1. [x] Trace presign, managed preparation, admission, signing and generic catch.
2. [x] Obtain the smallest implementation and synthetic proof from ReviewGPT.
3. [x] Run regression against unchanged source, then focused tests/typecheck.
4. [x] Complete parent privacy/cost/complexity review and update the owner doc.

## Verification results

- ReviewGPT supplied the source and tests-first patches against current main.
- Ten actual request-handler cases fail on original source only for missing
  diagnostic attribution; seven preservation cases already pass.
- Corrected code passes all 390 tests in the two existing owner files.
- Cloudflare typecheck passes after ordinary local Prisma client generation.
- Complexity debt remains unchanged; existing snapshot completion, route dispatch
  and reference comparison hotspots are not broadened by the diagnostic change.
- Docs drift and whitespace checks pass. Synthetic sentinels prove private
  content is omitted, error identity survives cleanup failures, successful
  signing adds no log and stale sessions never gain attempt correlation.

## Completion ownership

The implementation is complete. The same task retains ownership of final
pushed-head ReviewGPT, required CI, merge, protected deployment and read-only
observation, with external evidence in the PR and sweep memory. Natural presign
failures must exercise the new fields before coverage can be claimed; successful
snapshots alone do not establish the original failure cause or recovery.
Completed: 2026-10-21
