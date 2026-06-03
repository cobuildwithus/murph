# Runtime Platform Authority Fixes

## Goal

Fix the hosted runtime platform review findings and final cleanup items without
broadening the refactor:

- direct web-control transport must have the same runtime write-fence authority
  as proxy transport for hosted runtime callbacks
- direct web-control fetch diagnostics must distinguish caller aborts from
  timeouts
- snapshot direct upload ambiguity must fail through an explicit
  session-abandon path instead of looking like a resumable success path
- tests must prove the direct-invocation seam carries the expected authority
  inputs and advances the active lease after checkpoint

## Constraints

- Keep web as the hosted product/control-plane owner and Cloudflare as the execution adapter.
- Preserve the staged dirty-ack overlay contract: no early ack/delete, no extra durable queue, no extra checkpoint.
- Keep the runtime-platform split composable; avoid a generic port factory or broad new abstraction.
- Do not weaken stale write-fence, wrong-user, or callback-signing invariants.
- Keep route auth fail-closed and avoid widening public/user-controlled internal fetch authority.

## Working Set

- `apps/cloudflare/src/runtime-platform/**`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/cloudflare/test/hosted-workspace-invocation.test.ts`

## Verification Plan

- Focused runtime-platform and invocation tests.
- `pnpm typecheck`.
- `pnpm test:diff` or owner verification required by the workflow router.
- Security/privacy review, coverage-write when the coverage lane applies, and task-finish review before handoff.

## State

- Status: implemented; scoped commit blocked by overlapping dirty work in the
  current tree.
- Completed:
  - direct signed web-control callbacks attach active write-fence headers from
    the current checkpoint bridge
  - complete caller-supplied direct write-fence headers must match the current
    lease, and partial/stale headers fail closed before dispatch
  - direct fetch failure diagnostics record caller-aborted signals
  - direct R2 snapshot PUT transport and non-OK status failures now surface as
    non-resumable session failures
  - focused tests cover positive direct-header injection, incomplete/stale
    direct headers, caller-abort diagnostics, direct R2 non-resumability, and
    direct invocation checkpoint/provider authority wiring
- Verification:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-platform.test.ts --no-coverage`
    passed with 91 tests.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-workspace-invocation.test.ts --no-coverage`
    passed with 7 tests.
  - `git diff --check -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-06-03-runtime-platform-authority-fixes.md apps/cloudflare/src/runtime-platform/web-control-transport.ts apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/hosted-workspace-invocation.test.ts`
    passed.
  - `pnpm --dir apps/cloudflare typecheck` is blocked by unrelated dirty
    `packages/assistant-runtime/src/hosted-runtime.ts` syntax.
  - `pnpm --dir apps/cloudflare test:node` passed 75 files and 1105 tests
    before six suites failed on that same unrelated syntax blocker.
- Completion audits:
  - coverage-write: no remaining scoped coverage findings.
  - security/privacy review: no scoped findings.
  - task-finish review: no correctness findings; requested negative
    incomplete/stale direct write-fence tests, which were added and verified.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
