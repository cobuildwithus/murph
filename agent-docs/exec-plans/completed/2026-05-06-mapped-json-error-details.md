# Mapped JSON error detail logging

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Add sanitized mapped-domain-error details to shared JSON route logs.
- Success means mapped errors can expose safe diagnostic response details, such as Stripe operation names, in server logs without logging arbitrary route response details or sensitive identifiers.

## Scope

- In scope:
  - `apps/web/src/lib/http.ts`
  - `apps/web/test/http.test.ts`
  - `apps/web/test/device-sync-http.test.ts`
  - this execution plan
  - the shared coordination-ledger row for this lane
- Out of scope:
  - Changing hosted billing plan-change behavior.
  - Changing route response payloads.
  - Logging raw Stripe, request, user, or invite payloads.

## Constraints

- Preserve unrelated active ledger rows and working-tree edits.
- Do not expose local identifiers, secrets, raw payment payloads, request bodies, or account/customer data in code, tests, logs, or handoff.
- Keep the logging detail sanitizer conservative and metadata-only.

## Risks and mitigations

1. Risk: Generic mapped error logging could expose arbitrary `details` fields.
   Mitigation: Log only a bounded allowlist of diagnostic scalar keys and sanitize strings through the existing JSON log string sanitizer.
2. Risk: Route-specific detail logging could become duplicated or less private.
   Mitigation: Let route-specific `mapping.log.details` win when it already supplies detail fields.

## Tasks

1. Register the task in the coordination ledger. Done.
2. Inspect current mapped JSON error logging and hosted onboarding privacy behavior. Done.
3. Add sanitized mapped-error detail logging. Done.
4. Add focused HTTP logging coverage. Done.
5. Run required hosted-web verification and completion audits. Done.
6. Close the plan through the repo commit path. Pending.

## Current state

- `mapDomainJsonError` includes `details` in the JSON response payload.
- `logMappedJsonError` now adds `errorResponseDetails` from allowlisted scalar response details when route-specific log details have not already supplied `errorDetails` or `errorResponseDetails`.
- Device-sync mapped-error logging expectations now include the generic safe `status` detail.
- Hosted onboarding has a domain-specific allowlist for `errorDetails`; generic logging does not bypass it for arbitrary details.

## Verification

- `pnpm --dir apps/web test`: passed.
- `pnpm test:diff apps/web/src/lib/http.ts apps/web/test/http.test.ts apps/web/test/device-sync-http.test.ts`: passed after coverage-worker test addition.
- `pnpm typecheck`: passed after coverage-worker test-only addition.
- Final parent rerun of `pnpm test:diff apps/web/src/lib/http.ts apps/web/test/http.test.ts apps/web/test/device-sync-http.test.ts`: passed.
- Security/privacy review: passed with no findings.
- Coverage-write pass: added explicit `errorResponseDetails` override proof and reported diff-aware verification passed.
- Final completion review: passed with no findings.
Completed: 2026-05-06
