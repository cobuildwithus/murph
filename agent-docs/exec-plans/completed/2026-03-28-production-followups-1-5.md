# 2026-03-28 Production Followups 1-5

## Goal

Implement the five requested post-review followups across hosted runtime hardening, hosted device-sync failure isolation, health CLI/query surface alignment, health runtime typing, and the first substantive ownership move inside `@murph/assistant-services`.

## Scope

- `agent-docs/exec-plans/active/{2026-03-28-production-followups-1-5.md,COORDINATION_LEDGER.md}`
- `packages/assistant-runtime/src/{hosted-device-sync-control-plane.ts,hosted-device-sync-runtime.ts,hosted-email.ts}`
- `packages/assistant-runtime/src/hosted-runtime/{environment.ts,events/email.ts,events/share.ts,maintenance.ts,models.ts}`
- `packages/assistant-runtime/test/{hosted-runtime-maintenance.test.ts,hosted-runtime-http.test.ts}`
- `packages/cli/src/{health-cli-descriptors.ts,health-cli-method-types.ts,usecases/explicit-health-family-services.ts}`
- `packages/cli/test/health-tail.test.ts`
- `packages/query/src/{canonical-entities.ts}`
- `packages/query/src/health/{assessments.ts,projections.ts}`
- `packages/query/test/health-tail.test.ts`
- `packages/assistant-services/src/{operator-config.ts,store.ts}`
- `packages/assistant-runtime/test/assistant-services-boundary.test.ts`

## Constraints

- Preserve adjacent dirty-tree edits already in flight, especially the hosted-runtime, Cloudflare, and CLI follow-up lanes recorded in the coordination ledger.
- Keep hosted device-sync wake events fail-fast while making non-device-sync maintenance reconciliation best-effort.
- Do not invent a fake assessment status model; remove unsupported surface instead of silently ignoring it.
- Keep cross-package imports on public package entrypoints only.

## Planned Shape

1. Add a small hosted internal HTTP helper path with timeout-aware JSON/bytes reads, safe non-JSON error handling, and shared error wrapping for hosted runtime fetches.
2. Thread hosted timeout config through email/share/device-sync control-plane paths and make maintenance treat non-device-sync control-plane failures as logged best-effort behavior.
3. Remove assessment `status` filtering from descriptors and services, align query/runtime types to supported option shapes, and add regressions.
4. Move the assistant-services automation-state and self-delivery-target helper implementations into `@murph/assistant-services` so hosted runtime depends on real package-owned behavior for that operator-home slice instead of pure pass-through wrappers.
5. Run focused runtime/CLI/query tests, then required repo checks, then mandatory simplify, coverage, and finish-review audit passes before commit.

## Verification Plan

- Focused Vitest runs for:
  - hosted runtime HTTP + maintenance/device-sync behavior
  - query and CLI health-tail regressions
  - assistant-services boundary/operator-config coverage
- Required repo checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Direct scenario proof through focused behavior tests for:
  - timeout/non-JSON hosted internal HTTP handling
  - non-device-sync maintenance continuing across control-plane failures
  - assessment list surface no longer advertising or forwarding unsupported status filters
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
