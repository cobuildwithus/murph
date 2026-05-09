# DeepSec Hosted Operator Config Snapshot

Status: handoff
Created: 2026-05-09
Updated: 2026-05-09

## Goal

Stop hosted workspace snapshots from persisting mutable operator assistant config that can carry executable Codex selectors, while preserving hosted Codex continuity and cold/warm restore behavior.

## Success Criteria

- Hosted operator-home snapshot policy excludes `.murph/config.json`.
- Hosted Codex continuity manifest and explicit rollout files still survive snapshot/restore.
- Tests assert operator config is not restored from snapshots.
- Hosted cold/warm restart E2E coverage is inspected for config persistence assumptions.
- Hosted-local restart fixtures seed assistant defaults from runtime env rather than snapshot-carried operator config.
- Focused verification passes or any unrelated blockers are documented.
- DeepSec finding is marked fixed after verification.

## Scope

- In scope:
  - `packages/runtime-state` hosted bundle allowlist and tests.
  - Focused hosted-runtime E2E assertion that currently expects operator config persistence.
  - Hosted-local restart fixture paths that manually persisted hosted assistant config or omitted the trusted hosted assistant env needed after the policy change.
  - Durable architecture/runtime-state docs for the hosted snapshot contract.
  - DeepSec report metadata for the fixed finding.
  - Direct inspection of hosted-local cold/warm restart E2E fixtures.
- Out of scope:
  - New sanitization schemas for operator config.
  - Changing hosted assistant env bootstrap semantics.
  - Refactoring snapshot/restore architecture.

## Constraints

- Keep the implementation simple: remove the operator config file from the allowlist rather than trying to scrub it.
- Trusted hosted assistant defaults should come from platform-owned runtime env after restore.
- Preserve unrelated dirty worktree edits and active plan rows.
- Do not expose local usernames, home paths, secrets, or raw credentials in generated files or handoff.

## Risks And Mitigations

1. Risk: Hosted runtime reads missing assistant config before env bootstrap.
   Mitigation: Verify normal hosted default-target hydration seeds config from runtime env, and inspect E2E restart paths.
2. Risk: Codex continuity accidentally depends on `.murph/config.json`.
   Mitigation: Keep explicit Codex continuity file handling unchanged and run existing continuity tests.
3. Risk: Hosted-local fixtures rely on snapshot-carried config instead of trusted env.
   Mitigation: Update assertions/fixtures only where they encode the old policy.

## Tasks

1. Remove `.murph/config.json` from the hosted operator-home snapshot allowlist.
2. Update runtime-state tests to expect the config file to be excluded and not restored.
3. Update hosted-runtime self-brick E2E to assert poisoned operator config is dropped.
4. Update hosted-local cold/warm restart fixtures to use trusted runtime env for assistant defaults.
5. Run required verification and completion audits.

## Verification

- PASS: `pnpm --dir packages/runtime-state typecheck`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `pnpm --dir apps/cloudflare typecheck`
- PASS: `pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts test/hosted-bundle.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-codex-self-brick-e2e.test.ts test/hosted-runtime-workspace-restore-codex-continuity.test.ts --no-coverage`
- PASS: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runtime-bridge-workspace.test.ts test/runner-container.test.ts --no-coverage`
- PASS: `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts --no-coverage test/hosted-local-linq-scheduled-reminder-e2e.test.ts`
- PASS: `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts --no-coverage test/hosted-local-snapshot-stress-e2e.test.ts`
- PASS (earlier in this task before the repeated hosted-local container failure reproduced): `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts --no-coverage test/hosted-local-container-continuity-e2e.test.ts`
- FAIL (unrelated hosted-local container/hot-restore path): `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts --no-coverage test/hosted-local-codex-container-continuity-e2e.test.ts`
  - Fails after the first post-activation user turn with `workspace invocation container destroyed` / local proxy-token verification failure, then retries with conversation mailbox lag stuck at 1.
  - The failure occurs before operator config restore or Codex continuity from `.murph/config.json` can be involved.
  - A scoped exploratory container-cleanup patch moved this to a later `stale_attempt` heartbeat failure but did not make the fixture pass, so that patch was reverted and left out of the intended fix.
- FAIL (same unrelated hosted-local container/hot-restore path): `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts --no-coverage test/hosted-local-container-continuity-e2e.test.ts`
  - Reproduces the same first post-activation turn failure in the non-Codex fixture.
- PASS: security/privacy read-only subagent found no must-fix issues in the snapshot exclusion, activation/idle checkpoint gating, or explicit Codex continuity path.
- DeepSec metadata already marks `Hosted snapshots persist executable assistant selectors from operator config` as fixed in `.deepsec/data/murph/files/packages/runtime-state/src/hosted-bundles.ts.json`, `.deepsec/data/murph/reports/report.json`, and `.deepsec/data/murph/reports/report.md`.
