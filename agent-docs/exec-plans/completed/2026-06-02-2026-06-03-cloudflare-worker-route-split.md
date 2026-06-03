# Cloudflare Worker route split

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Split the Cloudflare Worker entrypoint into a small `worker/` module family
  without changing the supported public/internal route surface, auth semantics,
  Durable Object behavior, or error/log redaction behavior.

## Success criteria

- `apps/cloudflare/src/index.ts` stays a stable Wrangler entrypoint that only
  re-exports containers, the Durable Object wrapper, and the default worker.
- Route kernel, auth, route error mapping/logging, public/internal route tables,
  Durable Object wrapper, production route handlers, test/smoke route handlers,
  and route utilities live under `apps/cloudflare/src/worker/**`.
- Existing route order and `authorizeBeforeMethod` behavior are preserved.
- `web-callback-signature` auth continues to verify against cached request text
  with the current body-read behavior.
- The Durable Object wrapper remains a thin adapter over `HostedUserRunner`.
- Verification and required high-risk completion audits pass or have explicit
  unrelated blockers recorded.

## Scope

- In scope:
  - `apps/cloudflare/src/index.ts`
  - `apps/cloudflare/src/worker/**`
  - `apps/cloudflare/src/worker-routes/shared.ts` type import alignment with
    the concurrent user-runner module split.
  - Focused route/auth/entrypoint tests only if extraction exposes a coverage
    gap or type surface issue.
- Out of scope:
  - Changing hosted execution protocol behavior.
  - Changing runtime wake/checkpoint/container behavior.
  - Adding a router framework, dynamic route registry, compatibility flag, or
    new control-plane endpoint.
  - Editing unrelated active Cloudflare/assistant-runtime hard-cut work.

## Constraints

- Technical constraints:
  - Keep imports through existing package public entrypoints.
  - Preserve body limits, status codes, JSON shapes, route names, logging
    details, and path redaction.
  - Keep test-only routes gated by the centralized hosted worker test env check.
  - Prefer direct extraction over behavior cleanup.
- Product/process constraints:
  - High-risk/cross-cutting repo task: ledger, plan, security/privacy review,
    coverage review, final review, and full verification baseline are required.
  - Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Accidental auth-order change on internal routes.
   Mitigation: keep route specs declarative, move the existing route objects
   mechanically, and preserve every `authorizeBeforeMethod` value.
2. Risk: Cached body read behavior changes across auth and handlers.
   Mitigation: keep `readCachedRequestText` call sites and existing limits
   unchanged during extraction.
3. Risk: Module split introduces circular imports or private package boundary
   shortcuts.
   Mitigation: keep shared worker-local helpers in `worker/route-utils/**`,
   keep `worker-routes/shared.ts` as the existing lower-level worker adapter,
   and verify with typecheck/app tests.

## Tasks

1. Extract route kernel and public routes.
2. Extract errors/logging and auth/bound-user guards.
3. Extract the Durable Object wrapper.
4. Extract production runtime/status/browser-vault/user-data route handlers.
5. Extract deploy smoke, test artifact, test runner, and direct-R2 test routes.
6. Reassemble `worker/internal-routes.ts` and `worker/index.ts`.
7. Run verification and completion audits.
8. Finish the active plan and commit with `scripts/finish-task`.

## Decisions

- Use the requested `worker/` module family and keep `worker-routes/shared.ts`
  in place as the existing low-level adapter shared by Worker internals.
- Do not update architecture docs unless the refactor reveals a real runtime
  boundary change; the target is behavior-preserving ownership cleanup.

## Verification

- Commands to run:
  - `pnpm verify:acceptance`
  - Smaller iteration commands as needed, likely `pnpm --dir apps/cloudflare verify`
    or `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/index.ts apps/cloudflare/src/worker`
- Expected outcomes:
  - TypeScript and Cloudflare app route tests pass.
  - Required completion audits return no unresolved high-severity findings.
- Results:
  - Passed: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts`
    after coverage-write tests were added (`1` file, `72` tests).
  - Passed: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts apps/cloudflare/test/index-backpressure.test.ts`
    (`2` files, `76` tests).
  - Passed: `pnpm --dir apps/cloudflare test:workers` (`1` file, `1` test).
  - Direct route-order proof matched the new route table against `HEAD` route
    names exactly.
  - Blocked by unrelated active Cloudflare refactor: `pnpm --dir apps/cloudflare typecheck`
    fails in `apps/cloudflare/src/runtime-platform/workspace-port.ts` because
    `@murphai/assistant-runtime/hosted-invocation` does not export
    `checkpointHostedRuntimeBridgeWebWorkspace`.
  - Blocked by unrelated active Cloudflare refactor: `pnpm --dir apps/cloudflare test:node`
    previously failed `apps/cloudflare/test/user-runner-alarm.test.ts` on
    previous snapshot orphan-candidate recording in the active user-runner split.
  - Blocked by unrelated active work: `pnpm verify:acceptance` exits `1`.
    Current failures are `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts`
    missing `packages/health-commons/dist` during runner bundle staging,
    `apps/cloudflare/test/runtime-bridge-checkpoint.test.ts` resolving
    `checkpointHostedRuntimeBridgeWorkspace` to a non-function, and
    `packages/cli/test/incur-smoke.test.ts` timing out in root help.
- Audit results:
  - `simplify`: no high-severity findings; accepted focused cleanup for shared
    test-route env gate, bound-user header parsing, and unused route grouping.
  - `security-privacy-review`: no findings.
  - `coverage-write`: added focused Worker route table/auth-order/test-route
    hidden-method/redacted-log tests in `apps/cloudflare/test/index.test.ts`.
  - `task-finish-review`: no functional findings; accepted focused source-guard
    and plan-result fixes.
Completed: 2026-06-02
