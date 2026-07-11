# PR 502 Phlebas Review Fixes

## Goal

Resolve the accepted Phlebas ReviewGPT findings for PR 502:

1. Make retained companion dirty-payload replay keep one stable raw receipt and canonical integration-ingest identity.
2. Delete the duplicated web/runner companion record parser in favor of one dependency-light device-syncd-owned parser.
3. Keep malformed rejected health payload fragments out of shared operational logs.

## Constraints

- Preserve the closed two-kind companion schema, validation at both trust boundaries, and metadata-only diagnostics.
- Keep web-owned authentication, consent, request-byte limits, JSON decoding, and HTTP error mapping.
- Keep runner-owned stored-job envelope checks, stored-byte limits, JSON decoding, and nonretryable job error mapping.
- Keep hosted boot-safe constants dependency-free; do not add a package, dependency, capability gate, queue, or rollout state.
- Preserve ordinary Junction and other provider import behavior.

## Working Set

- `packages/device-syncd/src/companion-health-metadata-parser.ts`
- `packages/device-syncd/src/junction-resources.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/companion-health-metadata-parser.test.ts`
- `packages/device-syncd/test/junction-provider.test.ts`
- `apps/web/app/api/device-sync/companion/health-metadata/route.ts`
- `apps/web/src/lib/device-sync/companion.ts`
- `apps/web/test/device-sync-companion-routes.test.ts`
- `packages/importers/test/device-providers-junction-companion-health-metadata.test.ts`

## Verification Plan

- Focused device-syncd, web companion-route, and importer/core replay tests.
- Root typecheck plus truthful diff-aware coverage for the changed owners.
- Required security/privacy and coverage audits for the health-data ingress and replay boundary.
- Parent final diff review, push, exact-head CI, and a new Phlebas ReviewGPT round to zero accepted findings.

## Progress

- Stable replay identity, shared parsing, and fixed malformed-JSON error mapping are implemented.
- Focused suites, owner coverage, root typecheck, smoke-manifest integrity, and diff hygiene are green.
- The diff-aware reverse-dependent lane is blocked by an unrelated fixed-timeout assistant CLI startup test under extreme machine load; its changed owners passed directly.
- Security rerun found zero medium-or-higher issues after the malformed-JSON fix.
- Coverage audit added only fixed-error, nonretryable-job, and record-derived replay assertions; all focused suites are green.
- Parent final review found no remaining actionable issue; commit, CI, and the final Phlebas round remain.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
