# Diagnose sparse calendar record expansion

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal

Distinguish direct records from nested expansion in an existing calendar rejection without collecting payloads. A synthetic reproduction proves that the selection and validation owners can see different nested shapes; production attribution requires this missing signal before a behavior correction.

## Scope and constraints

Add one two-value classification at the importer error owner and allowlist it independently at service and hosted boundaries. Keep acceptance, retries, source authority, canonical writes and foreground priority unchanged. No new event, query, scheduler, persistence owner, raw data or external call. User authorized direct implementation and waived ReviewGPT; parent review and exact-head CI remain required.

## Tasks

1. Prove direct and nested synthetic cases; preserve existing validation.
2. Add finite classification and boundary rejection tests.
3. Run focused importer/service/runtime tests, affected typechecks, complexity and privacy review.
4. Commit, push draft, establish readiness, pass required exact-head CI and merge.
5. Use the existing protected release owner and smoke; observe natural traffic and inspect finite classifications before proposing a behavior correction.

## Telemetry decision

Question: did the strict validator expand a nested record after source-day selection?
Signal: normalizationRecordExpanded = false | true on the existing calendar-normalization failure only. Missing means unknown. Two values, one additional field per existing failure, unchanged event frequency and retention; no payload or timestamp content. Query bounded aggregates by this field and existing finite reason after deployment. Observe four hours, extending only through the existing task authorization if a correction is proven. Retain while the diagnostic question remains open; remove through reviewed code after attribution if it has no continuing use.

## Verification

Passed: two importer diagnostic tests (direct plus all four supported nested-envelope keys), 18 selected service diagnostics, 98 hosted device-pass cases, importer/device-sync/runtime typechecks, complexity with zero added debt and diff/privacy review. Parent review confirms Boolean(originFallback) derives only iterator provenance; both boundaries reject arbitrary non-boolean values and the hosted boundary restricts it to the existing error code. No behavior or new authority path is introduced. Required exact-head CI, merge, deployment and observation continue under task authority; their receipts remain in private automation memory. This completed plan records implementation evidence only.
Completed: 2026-11-11
