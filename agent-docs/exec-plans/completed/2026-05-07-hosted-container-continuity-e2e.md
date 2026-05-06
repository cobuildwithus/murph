Goal (incl. success criteria):
- Add a hosted-local end-to-end test that proves assistant session continuity survives a warm Cloudflare runner container idle-shutdown cycle.
- Success: the scenario sends a Linq message through the full hosted-local Worker/container path, forces the idle-shutdown checkpoint path without sleeping minutes, sends a second message after that checkpoint, and asserts the second assistant provider request still carries prior conversation context.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose local identifiers, secrets, raw message payloads, or filesystem paths in committed artifacts.
- Keep any clock/control hook test-only and gated behind the existing hosted-local test route guard.
- Avoid broad runtime changes; prefer harness/test helpers over production behavior changes.

Key decisions:
- Use a short hosted-local idle TTL in the scenario rather than changing production runner timing.
- Add a test-only Worker route that invokes the same Durable Object `alarm()` path after the idle checkpoint is due, gated by `NODE_ENV=test` and `MURPH_HOSTED_LOCAL_TEST_ROUTES=1`.
- Assert continuity from the second provider prompt/request text and the second Linq send, not from raw transcript files.

State:
- Implementation complete; focused checks passed; full local E2E blocked by unavailable Docker daemon.

Done:
- Read required repo routing, architecture, verification, security, reliability, and hosted-runtime protocol docs.
- Inspected existing hosted-local E2E harness and active ledger overlaps.
- Added the hosted-local test alarm route and harness helper.
- Added the named `container-continuity` hosted-local E2E scenario.
- Ran focused route/harness tests successfully.
- Ran task-local Cloudflare and hosted-local harness typechecks successfully.
- Fixed audit findings: the E2E now enables hosted-local test routes, surfaces alarm-route errors in timeout output, asserts successful idle-shutdown container cleanup log evidence, and route tests cover a successful alarm call.

Now:
- Run final completion review rerun after proof-gap fixes.

Next:
- Resolve audit findings if any.
- Commit if scoped commit is safe; otherwise report the overlapping dirty-work blocker.

Open questions (UNCONFIRMED if needed):
- Whether local workerd alarms fire reliably enough to remove the explicit test-only alarm trigger. UNCONFIRMED.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-05-07-hosted-container-continuity-e2e.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/worker-routes/shared.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-dev-harness.ts`
- `apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts apps/cloudflare/test/run-hosted-local-e2e.test.ts --no-coverage` passed.
- `pnpm hosted-local e2e container-continuity` failed before scenario execution because Docker daemon is unavailable in the local environment; the hosted-local Worker/container lane could not start.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/hosted-local-harness typecheck` passed.
- `git diff --check -- <task files>` passed.
- `bash scripts/workspace-verify.sh test:diff <task files>` failed in pre-existing raw-payload logging guard: `apps/cloudflare/src/runtime-bridge-workspace.ts` logs `input` via `console.warn`.
- `pnpm typecheck` failed on the same pre-existing raw-payload logging guard in `apps/cloudflare/src/runtime-bridge-workspace.ts`.
- Coverage-write pass added tests in `apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts` and `apps/cloudflare/test/hosted-local-e2e-support.test.ts`.
- After final-review fixes: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts --no-coverage` passed.
- After final-review fixes: `pnpm --dir apps/cloudflare typecheck` passed.
- After final-review fixes: `pnpm --dir packages/hosted-local-harness typecheck` passed.
- After final-review fixes: `git diff --check -- <task files>` passed.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
