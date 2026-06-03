# Runtime Platform Authority Fixes

## Goal

Fix the hosted runtime platform review findings and final cleanup items without
broadening the refactor:

- direct web-control transport must have the same runtime write-fence authority as proxy transport for state-changing and secret-returning runtime callbacks
- direct web-control fetch diagnostics must distinguish caller aborts from timeouts
- snapshot direct upload ambiguity must fail through an explicit, documented session-abandon path instead of looking like a resumable success path
- tests must prove the factory and direct-invocation seams carry the expected authority inputs
- hosted invocation tests must prove the direct invocation bridge contract instead of leaving an empty test shell
- runtime write-fence headers must have exactly one owner per trusted transport path
- direct invocation abort must be side-effect-free when the signal is already aborted
- current-snapshot orphan candidate markers must be deleted after proving the object is live
- signed-route body limits should be declared by route metadata, not auth internals
- `RuntimeProcessingController` should shed response construction and container wake helpers before it grows again
- control/test route numeric parsing should reject non-digit suffixes and whitespace

## Constraints

- Keep web as the hosted product/control-plane owner and Cloudflare as the execution adapter.
- Preserve the staged dirty-ack overlay contract: no early ack/delete, no extra durable queue, no extra checkpoint.
- Keep the runtime-platform split composable; avoid a generic port factory or broad new abstraction.
- Do not weaken stale write-fence, wrong-user, or callback-signing invariants.
- Keep route auth fail-closed and avoid widening public/user-controlled internal fetch authority.

## Working Set

- `apps/cloudflare/src/runtime-platform/**`
- `apps/cloudflare/src/hosted-workspace-invocation.ts`
- `apps/cloudflare/src/routes/**`
- `apps/cloudflare/src/user-runner/**`
- `apps/cloudflare/src/workspace-snapshot-sessions.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/cloudflare/test/hosted-workspace-invocation.test.ts`
- `apps/cloudflare/test/**` focused route/controller tests
- `packages/assistant-runtime/package.json`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-runtime/test/package-entrypoints.test.ts`
- `packages/assistant-runtime/test/hosted-invocation.test.ts`
- focused web route tests if needed for authority proof

## Verification Plan

- Focused runtime-platform and invocation tests.
- Assistant-runtime package entrypoint/build-shape proof if package tests change.
- Focused route/body-limit, numeric parsing, orphan-marker, and runtime-processing tests where existing seams allow.
- `pnpm typecheck`.
- `pnpm test:diff` or owner verification required by the workflow router.
- Security/privacy review, coverage-write when the coverage lane applies, and task-finish review before handoff.

## State

- Status: active.
- Current focus: implement the review fixes, keeping header authority single-owned and route/body parsing policy local to route metadata.
