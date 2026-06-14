# Hosted Temporal replay CI gate

Status: completed
Created: 2026-06-13
Updated: 2026-06-13

## Goal

- Add a CI-backed Temporal replay safety gate for the hosted user runtime
  workflow so future command-order changes cannot silently break existing
  workflow histories again.

## Success criteria

- A replay test runs `Worker.runReplayHistory` against a representative
  pre-patch mailbox history that scheduled `ensureRuntimeProcessing` directly.
- The existing hosted Temporal guard fails if the replay test/fixture is removed
  or stops using Temporal replay.
- Durable hosted-runtime/verification docs describe the new required replay
  proof.
- Focused package tests, typecheck, guard, and repo-required verification pass
  or any unrelated blocker is recorded.

## Scope

- In scope: hosted Temporal workflow replay test, guard script coverage, docs
  for replay-proof expectations.
- Out of scope: production workflow behavior changes, live Temporal history
  downloads, Temporal deployment/versioning strategy changes.

## Constraints

- Technical constraints: use official Temporal replay/versioning guidance;
  do not import undeclared transitive packages unless explicitly added; keep
  workflow history fixtures synthetic/redacted.
- Product/process constraints: preserve active hosted ingress work; no secrets,
  raw environment values, user identifiers, or local personal identifiers in
  files or handoff.

## Risks and mitigations

1. Risk: A state-machine-only test would miss Temporal command mismatch.
   Mitigation: use `Worker.runReplayHistory` against a history containing the
   old scheduled activity command.
2. Risk: The replay gate could be deleted while the architecture guard still
   passes.
   Mitigation: extend `hosted-temporal:guard` to require the replay test,
   Temporal replay API use, and synthetic legacy command fixture.

## Tasks

1. Confirm Temporal replay/versioning guidance and installed SDK API shape. Done.
2. Add replay history fixture/test for the legacy direct mailbox path. Done.
3. Extend hosted Temporal guard to require the replay gate. Done.
4. Update durable docs and testing map. Done.
5. Run verification and completion audits. Done.

## Decisions

- Use a synthetic, minimal Temporal history fixture for the exact failure shape:
  a mailbox signal followed by an `ensureRuntimeProcessing` activity schedule
  without the reconciliation-first patch marker.

## Verification

- Passed: `pnpm --dir packages/hosted-orchestrator-temporal test -- hosted-user-runtime-replay.test.ts`
- Passed: `pnpm --dir packages/hosted-orchestrator-temporal typecheck`
- Passed: `pnpm hosted-temporal:guard`
- Passed: `pnpm --dir packages/hosted-orchestrator-temporal test:coverage`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:smoke`
- Passed: `pnpm --dir packages/hosted-orchestrator-temporal build`
- Passed: `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-hosted-temporal-orchestration-guards.test.ts`
- Blocked unrelated: `pnpm test:repo-tools` fails in
  `scripts/wearable-fixture-capture.test.ts` on wearable timeseries resource
  expectations; this task did not touch that script or fixture path.

## Audits

- `security-privacy-review`: no medium-or-higher findings.
- `coverage-write`: no meaningful in-scope proof gap; no edits.
- `deep-review`: no actionable findings; residual risks are documented as
  fixture-specific replay coverage and textual guard semantics.
Completed: 2026-06-13
