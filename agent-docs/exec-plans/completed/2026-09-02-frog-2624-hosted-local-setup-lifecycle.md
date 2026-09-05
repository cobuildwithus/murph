# Join hosted-local setup after hook timeout

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Ensure a hosted-local E2E setup that is abandoned by a Vitest suite timeout
  or parent-process shutdown cancels its exact in-flight startup and joins the
  existing teardown before the suite command can finish.

## Success criteria

- The scenario launcher registers ownership before its first asynchronous
  setup step and releases it only after successful scenario cleanup.
- File-level teardown aborts and awaits every still-starting scenario, including
  one whose `beforeAll` promise never returned a scenario object.
- Cancellation reaches the existing hosted-local stack `AbortSignal` and the
  existing stack cleanup waits for every exact child it started.
- Parent exit synchronously signals only children owned by the exact stack.
- Focused lifecycle regressions, package typecheck/build, docs checks, diff
  hygiene, privacy scan, exact-head CI, and the applicable review gate pass.

## Scope

- In scope: hosted-local full-stack scenario setup ownership, harness-to-stack
  cancellation propagation, stack parent-exit signaling, focused lifecycle
  tests, and the canonical harness/testing documentation.
- Out of scope: product runtime behavior, deployment configuration, dependencies,
  unrelated hosted-local issues #2647/#2661/#2677, and broad process discovery
  or PID-based cleanup.

## Constraints

- Technical constraints: reuse the existing stack abort and bounded exact-child
  teardown; do not add a daemon, PID sweep, supervisor, or new persisted state.
- Product/process constraints: preserve public-data/privacy boundaries, keep
  the patch test-harness-only, and use the draft PR/exact-head CI workflow.

## Risks and mitigations

1. Risk: teardown races with a startup promise that creates resources after an
   early snapshot.
   Mitigation: abort first, await the exact startup promise, and let its single
   idempotent resource cleanup own all resources created before rejection.
2. Risk: process-exit handling signals unrelated local services.
   Mitigation: retain and signal only child handles created by the exact stack.

## Tasks

1. Add a focused failing regression for an interrupted pending scenario setup.
2. Add one in-memory scenario-start owner that aborts and joins pending setup
   from file teardown, then delegates normal stop after success.
3. Propagate cancellation through the E2E harness into the existing stack and
   make the stack synchronously signal its retained children on parent exit.
4. Run focused lifecycle proof, typecheck/build, docs and completion checks;
   inspect the privacy-safe final diff.
5. Commit, push, open the draft PR, complete proportional review and exact-head
   CI, then land/close/retire only if every low-risk gate remains satisfied.

## Decisions

- Keep ownership in the existing test harness and stack; no parallel cleanup
  owner or process classifier is introduced.
- Register the stack's parent-exit and startup-abort listeners through one
  small lifecycle helper so the existing stack owner retains exact child
  handles without increasing the large startup function's complexity debt.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.test.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts --no-coverage`
  passed 39 tests.
- The focused hosted-local-harness parent-exit regression passed; a full file
  run passed 76 of 77 tests and exposed one unrelated existing cwd-sensitive
  Linq tunnel path assertion.
- Cloudflare and hosted-local-harness typechecks passed, as did the harness
  build, `pnpm complexity:diff`, docs drift/gardening, `git diff --check`, and
  the scoped privacy scan.
- Exact-head GitHub checks and the current-base merge fence remain PR landing
  gates rather than local implementation evidence.
Completed: 2026-09-02
