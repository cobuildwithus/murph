# Classify computer failures without private payloads

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Goal

Distinguish script/runtime errors, navigation/network failures, and unclassified diagnostics in the existing computer failure event without persisting private provider text.

## Success criteria

- Existing logging receives only bounded fixed-vocabulary classification from already available diagnostic channels.
- Synthetic tests expose the missing distinction at base and prove its presence and privacy at head.
- Success values, original error identity/status/retryability, timing and best-effort nonblocking logging remain unchanged.
- Parent review, scoped commit, final ReviewGPT and required exact-head CI pass.

## Scope

Existing computer failure telemetry owner and its tests/documentation. No functional fix, schema, state, extra provider/DB calls, log volume, credentials, retention, dependencies, configuration or access-policy changes.

## Risks and mitigations

Untrusted strings must not escape or create false diagnostic categories through stdout/page text. Use fixed signatures and bounded scanning. Unknown remains unknown; classifications alone do not establish tool recovery.

## Tasks

1. Have ReviewGPT implement the smallest observation through the real logging/sanitization pipeline.
2. Verify base/head synthetic failures, privacy, logging failure behavior, typecheck and complexity.
3. Close plan and complete PR review/CI. A telemetry-only merge is authorized only after all gates pass; use canonical deployment and verify revision/natural events separately.

## Product UX and changelog

Internal-only telemetry; no product behavior, prompt, tool contract or user-facing change. No changelog item is needed.

## Verification

- ReviewGPT implemented 18 production lines extending the existing category with fixed JavaScript and navigation/network diagnostic signatures. No other production owner changed.
- Base negative control: 13 new signature cases fail solely because the category is absent; 25 existing/privacy cases pass.
- Candidate: 47 tests pass across computer runtime logging and Kernel client suites. The real extractor, logging wrapper, append/read parsers and JSON storage roundtrip preserve fixed fields without private text.
- Tests preserve original error identity, status, retryability, unknown-outcome flag, provider timeout argument and successful result identity. Logging remains deferred and best-effort, including unavailable after scheduling and failed/unresolved writes.
- Web typecheck, complexity (zero debt, maximum 10), documentation drift and diff checks pass.
- Parent review confirms two bounded diagnostic channels, anchored signatures, existing category precedence and no additional event, database/provider call or wait.
- Exact-head required CI and independent final ReviewGPT remain PR gates. Production failures stay unresolved until natural telemetry distinguishes their causes; added categories cannot retrospectively classify historical events.
Completed: 2026-10-01
