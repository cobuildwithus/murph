# Device sync service seams

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Remove the hidden `device-syncd` service internals/testing registry and replace
  it with explicit service methods plus narrow constructor-injected scheduler
  and worker tick seams.

## Success criteria

- `packages/device-syncd/src/service-internals.ts` and
  `packages/device-syncd/src/service-testing.ts` are deleted.
- HTTP/control callers use explicit `DeviceSyncService` methods for manual
  reconcile and disconnect instead of a WeakMap lookup.
- Tests that need worker/scheduler edge behavior use injected tick/drain seams
  and public service behavior, not public-service-to-internal backchannels.
- Focused device-syncd tests and required repo checks pass or have a documented
  unrelated blocker.

## Scope

- In scope:
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/service-controls.ts`
- `packages/device-syncd/src/http.ts`
- focused `packages/device-syncd` tests
- Out of scope:
- Provider behavior, importer/core write paths, hosted dirty-ack runtime work,
  assistant-runtime device-sync behavior, and broad control-plane redesign.

## Constraints

- Technical constraints:
- Keep canonical health writes routed through importers/core.
- Keep `store` private to the concrete service implementation.
- Preserve worker/scheduler non-reentrant behavior and worker batch error
  logging.
- Avoid new global registries, singleton state, or compatibility backchannels.
- Product/process constraints:
- No user-facing product behavior change.
- Preserve unrelated dirty work in the checkout.

## Risks and mitigations

1. Risk: Making control methods explicit widens the public TypeScript service
   surface.
   Mitigation: Keep only the operations already exposed by authenticated HTTP
   control routes and keep storage/privileged internals private.
2. Risk: Injected test seams could become a broad abstraction.
   Mitigation: Keep the ports package-local, minimal, and tied to existing tick
   behavior only.

## Tasks

1. Inspect current internals registry, test hooks, and control call sites.
2. Add explicit service control methods and narrow injected worker/scheduler
   ports.
3. Remove internals/testing modules and update tests.
4. Run scoped verification and required completion audits.
5. Finish the active plan and commit with `scripts/finish-task` if safe.

## Decisions

- Treat manual reconcile and disconnect as legitimate service controls because
  the daemon HTTP routes already expose them behind the loopback bearer boundary.
- Keep the worker batch tick private to service construction and tests via
  injected ports instead of making it another public service method.
- Do not expose `publicIngress` on `DeviceSyncService`; the facade already
  exposes the needed ingress operations and the raw ingress object carries a
  store port.

## Verification

- Passed:
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd test -- service.test.ts http.test.ts`
  (37 files / 591 tests)
- `pnpm --dir packages/device-syncd test:coverage` (37 files / 591 tests,
  thresholds green)
- `git diff --check` on the touched device-syncd/plan files
- Stale-hook search for deleted service internals/control/testing symbols under
  `packages/device-syncd/src`, `packages/device-syncd/test`, and
  `packages/device-syncd/package.json`
- Attempted with unrelated blockers:
- Scoped `bash scripts/workspace-verify.sh test:diff ...` for the device-syncd
  paths failed outside this task on unrelated hosted-web/assistant-runtime dirty
  work.
- `pnpm typecheck` failed outside this task on unrelated hosted-web dirty work.
Completed: 2026-06-03
