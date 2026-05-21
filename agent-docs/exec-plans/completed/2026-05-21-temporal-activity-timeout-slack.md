# Temporal Activity timeout slack

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Make the Temporal ensure-execution Activity timeout budget explicitly larger
  than the internal Cloudflare HTTP request timeout, leaving reporting slack for
  response parsing and Activity completion.

## Success criteria

- Shared workflow timing defaults derive:
  - internal HTTP timeout = `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS`
    + `HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS`
  - Activity Start-To-Close timeout = internal HTTP timeout + 30 seconds.
- The Activity HTTP client uses the internal HTTP timeout, not the
  Start-To-Close timeout.
- Tests cover the derived slack and existing write-fence idempotency proof
  remains intact.
- Durable docs describe the timeout invariant.

## Scope

- In scope:
  - Hosted Temporal timeout env parsing.
  - Ensure-execution Activity HTTP timeout naming/use.
  - Hosted Temporal workflow default timeout constant.
  - Focused tests and docs for the timing invariant.
- Out of scope:
  - Changing Cloudflare runner write-fence behavior.
  - Full idempotency-chain redesign.

## Constraints

- Technical constraints:
  - Preserve overlapping Temporal env parser and Activity retry-classification
    work already active in this checkout.
  - Keep Temporal workflow state pointer-only.
- Product/process constraints:
  - Do not expose local identifiers, secrets, raw payloads, or full paths in
    generated docs or commits.

## Risks and mitigations

1. Risk:
   Timeout derivation drifts again between the Activity client and workflow
   options.
   Mitigation:
   Use explicit names and focused tests for both values.
2. Risk:
   Overlapping dirty Temporal files make scoped commit unsafe.
   Mitigation:
   Keep the diff narrow and report if commit scoping is blocked.

## Tasks

1. Register coordination scope.
2. Split HTTP timeout derivation from Activity Start-To-Close timeout.
3. Update focused tests and default expectations.
4. Document the invariant and run required verification/audits.

## Decisions

- Use a fixed 30 second reporting slack for ensure-execution Activity
  Start-To-Close over the internal HTTP timeout.

## Verification

- Passed:
  - `pnpm --dir packages/hosted-execution test -- test/temporal-env.test.ts`
  - `pnpm --dir packages/hosted-orchestrator-temporal test -- test/ensure-cloudflare-execution.test.ts test/temporal-env.test.ts test/workflow-entrypoint.test.ts test/signal-hosted-user-runtime.test.ts`
  - `pnpm --dir packages/hosted-orchestrator-temporal test -- test/hosted-user-runtime-workflow.test.ts test/temporal-env.test.ts test/workflow-entrypoint.test.ts`
  - `pnpm --dir apps/web test -- test/hosted-orchestration-signal-runtime.test.ts test/hosted-orchestration-temporal-client.test.ts`
  - `bash scripts/workspace-verify.sh test:diff <task paths>`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check`
  - Task diff privacy scan for local identifier and authorization leakage

## Completion

- Security/privacy review found no findings.
- Coverage review found no missing proof gap.
- Final review findings were fixed:
  - Continue-As-New now upgrades the exact legacy ensure-execution timeout.
  - Shared timeout derivation now rejects budgets that would exceed the
    Temporal Start-To-Close maximum.
- No scoped commit was created because overlapping active dirty work in the
  same files makes a task-only commit unsafe in this checkout.
Completed: 2026-05-21
