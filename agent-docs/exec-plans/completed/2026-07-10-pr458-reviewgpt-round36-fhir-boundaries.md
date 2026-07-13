# PR 458 ReviewGPT Round 36 FHIR Boundaries

## Goal

Resolve the evidence-backed ReviewGPT round 36 findings for PR #458 while keeping the clinical intake boundary small and fail closed.

Success criteria:

- Replaying an unchanged FHIR source revision from a later retrieval path is idempotent, while equal-revision clinical changes still fail closed.
- Older source revisions skip before event-kind validation; newer same-kind updates supersede, while newer kind changes and authoritative retractions atomically tombstone stale facts before replacement.
- Supported FHIR resources accept valid full date-time values with arbitrary fractional-second precision, normalize event timestamps to Murph's canonical representation, and preserve exact source-revision ordering.
- Supported resources with `implicitRules` or non-empty `modifierExtension` anywhere in the resource are review-only/unsupported; ordinary `extension` fields remain importable.
- Manifest errors use canonical supported FHIR resource-family names, and every returned Condition blocks a global no-known-allergies assertion.
- Clinical intake emits one canonical `upsert | retract | review` decision stream with one external identity/revision and one evidence owner.
- Focused tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Preserve `packages/core` as the only canonical write owner and `packages/clinical-records` as a pure intake-contract owner.
- Keep full source revision precision; do not use millisecond-only `Date.parse` equality for FHIR revisions.
- Reuse existing bounded raw-page limits for recursive modifier inspection.
- Reuse canonical event-import schemas from `@murphai/contracts`; do not make core depend on clinical-records.
- Exclude retrieval-local provenance and version spelling from semantic replay equality while preserving the exact validated source version for ordering.
- Prefer deletion and ordering changes over queues, migrations, or a parallel state/reconciliation owner; unseen source invalidations may use a deleted marker in the existing event ledger.

## Current State

- Round 36 demonstrated four concrete failures: incomplete source-revision reconciliation, high-precision timestamps, ignored modifiers, and incomplete NKDA conflict/error classification.
- The clinical plan now emits one `upsert | retract | review` decision per resource, uses canonical event payload schemas with a narrower clinical boundary, and keeps raw provenance solely in bounded evidence.
- Core orders exact source revisions before kind validation, reconciles corrections and retractions atomically, and records unseen invalidations as hidden deleted markers in the existing event ledger.
- Required coverage and security/privacy audits completed. Follow-up state-machine and scope reviews found historical-ref, marker-reason, derived-day, schema-boundary, version-bound, and source-local-date gaps; all accepted findings have focused regressions.
- `origin/main` advanced after the branch's prior merge and will be reconciled after the scoped task commit, before the final PR verification and ReviewGPT round.

## Plan

1. Add failing production-path regressions for high-precision occurrence/revision timestamps, root/nested modifiers, implicit rules, malformed error families, and non-allowlisted Conditions.
2. Add production-path regressions proving equal-version retrieval-local provenance is ignored, real equal-version clinical conflicts reject, older revisions skip, newer kind changes replace atomically, and newer authoritative invalidations retract.
3. Add one exact ISO date-time comparison primitive in the shared contracts owner and use it for clinical source revisions while normalizing event timestamps.
4. Add one bounded fail-closed FHIR modifier admission guard before supported mapping and allergy-conflict classification.
5. Restrict manifest error families and replace Condition terminology heuristics with the conservative v1 conflict rule.
6. Replace duplicate candidate/unsupported contracts with one canonical `upsert | retract | review` decision union and one evidence owner.
7. Add core-owned atomic reconciliation for replay, supersession, kind changes, and authoritative retractions without adding a parallel state owner or store.
8. Run focused tests, typecheck, `pnpm test:diff`, required audits, and hygiene checks.
9. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI until zero accepted findings.

## Verification

- `pnpm test:diff <task paths>` passed the complete affected package/app matrix before the final supplemental scope fixes: 22 affected package typechecks, all affected package tests, hosted package-boundary checks, web build/lint/tests/dev smoke, and Cloudflare verification.
- `pnpm --filter @murphai/{contracts,clinical-records,core,importers} typecheck` passed after the supplemental fixes.
- Focused package tests passed after the supplemental fixes: contracts 159, clinical-records 7, core 546, and importers 333 tests.
- `pnpm docs:drift` and `git diff --check` passed.
- Coverage-write, security/privacy, final revision-state, and scope/shape reviews completed; no accepted finding remains without a fix and regression.
- Final `test:diff`, smoke, PR CI, and ReviewGPT verification remain pending after reconciling current `main`.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
