# PR 458 ReviewGPT Round 34 Trust And Identity

## Goal

Resolve the accepted ReviewGPT round 34 findings for PR #458 without adding a writer or a second clinical state owner.

Success criteria:

- Every declared raw FHIR page is parsed once and validated against its manifest resource family and patient namespace before mapping.
- No-known-allergies output requires explicit, terminal, error-free completion for every conflict-bearing resource family.
- FHIR candidate identity derives only from the source resource, while provider freshness prevents stale replays from superseding newer canonical events.
- Focused regressions, owner tests, workspace typecheck, diff verification, required completion audits, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Preserve raw evidence refs, bounded input/output limits, deterministic plans, and fail-closed ambiguity handling.
- Keep canonical mutation outside the clinical importer.
- Reuse the existing manifest, external-ref, and event-import owners; add no queue, datastore, compatibility layer, or speculative lifecycle machinery.
- The manifest format is still an unshipped foundation, so make the completion and patient-hash contract explicit rather than preserving an unsafe incomplete shape.

## Current State

- ReviewGPT round 34 completed on the pushed head with `REVIEW_COMPLETE`.
- Direct regressions proved the five accepted failures: cross-patient and mislabeled resources were accepted, dangling pagination could emit no-known-allergies, one Observation could split into multiple external identities, and an older source revision could replace a newer canonical event.
- The manifest now declares completed resource families, raw pages are parsed and validated once, absolute Patient references are bound to the manifest FHIR base, candidates use resource-level identity plus provider freshness, and core bulk event import orders strict ISO source revisions monotonically.
- The required security/privacy pass found and closed three medium issues: write-only SMART scopes, foreign-base absolute Patient references, and pagination links not bound to the manifest FHIR base. Same-base pagination is now segment-exact, every captured continuation page must be root-reachable, and focused regressions cover foreign, sibling-prefix, credential-bearing, and orphaned pages.
- Coverage-write and parent review are complete. Parent review also restored the pre-existing event-kind invariant ahead of source-revision ordering, so an older malformed cross-kind payload still rejects instead of being silently skipped.

## Plan

1. Add failing regressions for patient mismatch, mixed resource families, unresolved pagination, and replay/facet ordering.
2. Make the manifest explicitly record completed resource families and export canonical patient/page hashing helpers.
3. Collapse import planning to one validated raw-page pass with family, patient, pagination, and allergy-evidence checks.
4. Remove mapping-derived external-ref facets and enforce optional source-updated ordering at the core event-import owner.
5. Run focused tests, typecheck, diff verification, security/privacy review, coverage-write, and the parent final review.
6. Commit with `scripts/finish-task`, merge current `main`, push, and rerun ReviewGPT plus PR CI.

## Verification

- `pnpm --dir packages/clinical-records typecheck` — pass.
- `pnpm --dir packages/clinical-records test` — 8 tests pass.
- `pnpm --dir packages/importers typecheck` — pass.
- `pnpm --dir packages/importers exec vitest run test/clinical-records.test.ts` — 43 tests pass, including SMART scope, patient-origin, pagination-origin/reachability, pagination-cycle, and canonical import boundaries.
- `pnpm --dir packages/importers test` — 324 package tests pass.
- `pnpm --dir packages/core typecheck` — pass.
- `pnpm --dir packages/core exec vitest run test/import-event-batch.test.ts` — 19 tests pass.
- Exact affected-path `pnpm test:diff` — pass, including 19 typechecks, 538 core tests, 324 importer tests, 4,026 web tests, 1,679 Cloudflare tests, boundary checks, builds, dev smoke, and lint.
- `pnpm test:smoke` — pass for 201 scenarios, 11 sample inputs, and 28 golden-output directories.
- `pnpm typecheck` — pass.
- Required security/privacy re-review — no medium-or-higher findings remain.
- Required coverage-write and parent final review — complete with no unresolved actionable gaps.

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
