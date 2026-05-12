# Remove stale hosted runner in-process transport

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Remove the stale optional Cloudflare hosted runner in-process transport so
  workspace invocations have one maintained runtime path: the isolated child
  process that already carries outbound-intercept identity headers.

## Success criteria

- `apps/cloudflare/src/node-runner.ts` no longer exposes or branches on
  `runMode: "in-process"`.
- The remaining node-runner tests prove jobs are normalized and forwarded into
  the isolated runner.
- Cloudflare typecheck and focused tests pass.

## Scope

- In scope: `apps/cloudflare/src/node-runner.ts`,
  `apps/cloudflare/test/node-runner.test.ts`, direct proof in
  `apps/cloudflare/test/node-runner-child.test.ts`, and any directly stale docs.
- Out of scope: changing isolated child runtime behavior, outbound intercept
  policy, Durable Object scheduling, or live hosted-local E2E harness behavior.

## Constraints

- Technical constraints: preserve the child process as the only hosted runtime
  execution boundary; do not add compatibility flags or alternate transports.
- Product/process constraints: preserve unrelated active hosted runner work and
  do not expose local identifiers or secrets in diagnostics.

## Risks and mitigations

1. Risk: tests were using in-process mode as a shortcut for mailbox decode
   coverage.
   Mitigation: rely on existing child/runtime-platform tests for mailbox decode
   and intercept header coverage, and keep node-runner tests focused on the
   parent runner seam.

## Tasks

1. Remove the optional in-process branch and dependency surface from
   `node-runner.ts`.
2. Delete or rewrite stale in-process-only tests.
3. Run focused Cloudflare tests and typecheck.
4. Run focused verification and completion review.

## Decisions

- Delete the optional in-process transport rather than patching it with
  `proxyBoundUserIdHeader`; one maintained transport is cleaner under the
  intercept architecture.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/node-runner-abort.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-platform.test.ts`
- Passed: `pnpm --dir apps/cloudflare typecheck`
- Blocked by unrelated dirty work: `pnpm test:diff apps/cloudflare/src/node-runner.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/node-runner-child.test.ts` failed in `apps/cloudflare/test/runner-child-launcher.test.ts` on a CA bundle env expectation mismatch involving dirty launcher files outside this task. This task does not modify the child-launcher path.
