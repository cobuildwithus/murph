# Hosted runner secret, bundle cleanup, and finalize durability hardening

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

Fix the reported hosted execution boundary and cleanup issues without widening into unrelated hosted app topology or product behavior.

## Success criteria

- Isolated child runtime processes receive only child-safe runtime env and cannot read operator-only hosted control-plane signing, automation, platform-envelope, or wake-encryption secrets.
- Runtime web-control calls still work through the per-run internal proxy token path.
- Shared-by-hash bundle objects are not deleted during per-user bundle transitions.
- Bundle transition cleanup fails closed when the next bundle object is missing and preserves the previous snapshot and artifacts.
- Finalize-retry cleanup metadata is durable enough that a later `resumeFinalize` acquisition cannot silently finalize while losing transient wake cleanup inputs.
- Focused tests cover the reported regressions and required verification/audit results are recorded.

## Scope

Primary files:

- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `apps/cloudflare/src/bundle-gc.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`

Directly coupled tests:

- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/node-runner-isolated.test.ts`
- `apps/cloudflare/test/runner-bundle-helpers.test.ts`
- `apps/cloudflare/test/user-runner-resume-finalize.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Coordinate with existing active hosted-runner and hosted-run reliability rows on overlapping files.
- Do not add dependencies.
- Do not weaken hosted web callback auth or widen Cloudflare's control-plane authority.

## Tasks

1. Inspect current env forwarding, bundle cleanup, and finalize-resume cleanup paths.
2. Split operator/container env from child runtime env and add final child-env denylist coverage.
3. Change bundle transition GC so shared bundle objects are preserved and missing next bundles fail closed.
4. Make finalize cleanup metadata mandatory for resumed finalize when cleanup inputs are needed.
5. Add focused regression tests.
6. Run verification and required completion audit passes.

## Progress

- 2026-04-24: Plan opened for the reported hosted runner/security/storage cleanup findings.
- 2026-04-24: Implemented supervisor env split so container startup receives only `PORT`; child runtime env and assistant-runtime sanitizers now strip hosted control-plane, callback signing, platform-envelope, wake, process-control, and loader env keys.
- 2026-04-24: Hardened bundle transition GC to throw on missing `nextBundleRef` when cleanup requires it, preserving previous bundle/artifacts on partial storage loss.
- 2026-04-24: Added focused regressions for supervisor/child secret stripping, cross-user identical bundle refs, and missing-next-bundle fail-closed behavior. Existing finalize-resume tests already cover required pending-cleanup fail-closed cases.
- 2026-04-24: Focused Cloudflare tests passed: `apps/cloudflare/test/runner-container.test.ts`, `node-runner-isolated.test.ts`, `runner-env.test.ts`, `runner-bundle-helpers.test.ts`, and direct `runner-child-launcher.test.ts`. Assistant-runtime env test passed. Typecheck remains blocked by unrelated/concurrent managed-auto-reply typing work in `packages/assistant-runtime/src/hosted-runtime/context.ts` and related tests.
- 2026-04-24: Required `coverage-write` audit reported no additional test changes needed. Required `task-finish-review` reported no blocking findings; it noted no live native-container smoke proof and that `runner-child-launcher` files must land with the isolated-runner import.
Completed: 2026-04-24
