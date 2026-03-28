You are Codex Audit Worker CF-R operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker CF-R` only if you need to edit files; review-only is preferred.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the required completion-workflow final review for the Cloudflare pre-deploy fixes.
- Read and follow `agent-docs/prompts/task-finish-review.md` exactly.

Review scope:
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/crypto.ts`
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/outbox-delivery-journal.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/src/user-runner/types.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- `apps/cloudflare/test/env.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/user-runner.test.ts`
- `apps/cloudflare/test/workers/runtime.test.ts`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/generated/doc-inventory.md`
- `agent-docs/exec-plans/active/2026-03-27-cloudflare-predeploy-fixes.md`

What changed and why:
- Closed the known Cloudflare deploy blockers and pre-deploy correctness gaps: explicit native-container sizing, stale-wake handling, transient journal lifecycle cleanup, smoke-test depth, observability/config truthfulness, and fail-closed native runner control handling.

Why this implementation fits the current system:
- It stays within the existing Cloudflare hosted-runner control plane and uses direct Durable Object/container boundaries already established in the app.
- It improves deploy/runtime safety without changing the public control plane or bundle-storage model.

Invariants and assumptions:
- Deploy config must keep pointing at the real native-runner image path and now include explicit sizing.
- Container/worker internal control paths must stay closed when required tokens are missing.
- Queue state must not transition back into immediate alarm churn from stale stored wake timestamps.
- Journal migration must remain backward-compatible for reads while making new writes transient-prefix friendly.

Verification evidence already run:
- `pnpm --dir apps/cloudflare verify` -> passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts --no-coverage --maxWorkers 1` -> passed.

Direct scenario proof already run:
- Rendered deploy config shows `instance_type: "basic"` and omits `secrets.required`.
- Mocked smoke progression only passes after queue drain, `lastRunAt` advancement, and bundle refs exist.

Output:
- Return concrete findings only if they are actionable within this bounded scope.
- If you find no actionable issues, say so explicitly and note any residual human-verification gaps.
