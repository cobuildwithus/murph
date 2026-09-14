# CLI validation diagnostics

Status: active
Created: 2026-09-13
Updated: 2026-09-13
Base: `ad68eb63915e72a6e7aab3f83894684343b5b69e`.

## Outcome and evidence

Preserve finite schema evidence at the existing telemetry boundary without changing
CLI behavior. Synthetic real-entry probes supplied with this task establish that
Incur's own `publicIssues` and rendered `fieldErrors` distinguish missing fields
from invalid values; current timing discards those distinctions. The cause of
actual member argument errors remains **unproven**; no member values were inspected.
The knowledge service already throws `knowledge_source_unreadable`,
`knowledge_invalid_source_path`, and `knowledge_invalid_library_slug`; only their
finite timing admission and existing issue categories are missing.

## Scope and invariants

Use `runtime-state/cli-timing` as the shared selection/normalization owner. Select
at most one issue from the first eight own array entries, reading own data
properties only. Admit exact static field names for `food search-labels`
(query, limit), `knowledge upsert` (body, slug, title, pageType, status,
clearLibraryLinks, relatedSlug, librarySlug, sourcePath), and
`knowledge append-section` (slug, heading, body, title, position, sourcePath).
Retain only a finite field, standard issue code, and explicitly boolean missing
flag. Never infer from argv, messages, values, nested paths, causes or prototypes.
Unknown/malformed detail is absent, not lost failure accounting.

Observe the original typed throw before projection and use the existing bounded
16 KiB assistant completion envelope only after positive registered-command
attribution. Preserve schema v1, counts, outcomes, first-observation ownership,
cap eight, drop accounting and the 8,192-byte datagram limit. Distinct validation
variants have distinct aggregation identities. Legacy absence stays absent.
No domain writes, input repair, replay, prompt/routing change, new transport,
state, dependency or changelog. Earlier exit, memory, compressed-source and cron
fixes remain untouched; missing pages, pre-dispatch unknowns and shell guards
retain their existing boundaries.

## Execution and proof

- [x] Trace timing bridge, portable normalization, bounded envelope consumer and
  current command schemas; identify the three existing source throw sites.
- [x] Implement shared finite extraction, variant-aware merging and consumers.
- [x] Extend tests using the existing real CLI child fixture for two food failures, two upsert
  failures, missing append heading and adjacent success; compare timing on/off
  output, exits, report count, provider calls and unchanged synthetic vault.
- [x] Add focused privacy, own-data/accessor/proxy, bounded-array, wire/cap,
  mixed-peer and actual issue-sanitizer/parser tests; update the durable contract.
- [x] Package the implementation and incremental correction as apply-compatible
  patches. No external systems or production data.
- [x] Centralize validation-code gating and optional failure-property construction
  in the existing shared helper; preserve selectors, privacy checks and test scope.

## Verification and closure

The parent owns native verification, independent review, Git/PR and merge. Record
current results in the PR and final closure, including `pnpm complexity:diff`,
runtime-state/native-process, CLI subprocess and assistant diagnostics suites,
and relevant package typechecks. Local authoring checks below are not parent
verification results. Close this plan with `scripts/close-exec-plan.sh` after
those gates are satisfied; retain consumer-first rollout as the release contract.

## Release and compatibility

Consumer-first: ship portable normalizers and assistant issue readers before
producers emit optional validation metadata or the three newly admitted codes.
Old v1 readers discard unknown optional detail and normalize unfamiliar codes to
`unknown` without losing calls/outcomes; new readers accept old entries without
inventing evidence. Rollback loses detail only. This patch does not deploy.

## Local authoring checks

The initial authoring pass used standalone TypeScript and test-registration
adapters for focused timing/process/transport checks and checked old/new reader
compatibility. These source-only checks do not replace native workspace gates.
Correction checks are recorded with the incremental patch handoff.

The durable failure-count query sums validation variants within each command
summary before the existing per-turn/code/stage maximum. No database was queried.
The correction changes only helper composition: one optional nested timing object
and the existing flat assistant metadata remain unchanged.
