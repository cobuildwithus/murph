You are Codex Audit Worker CF-T operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker CF-T` if you need to edit files.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the required completion-workflow test-coverage audit for the Cloudflare pre-deploy fixes.
- Read and follow `agent-docs/prompts/test-coverage-audit.md` exactly.

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
- Same Cloudflare pre-deploy fixes as the simplify pass, with highest risk around alarm scheduling correctness, config generation, transient journal cleanup, and smoke proof depth.

Why this implementation fits the current system:
- It keeps tests close to the Worker/DO/container boundaries the app already uses instead of inventing parallel seams.
- It uses the operator status surface as the deploy-smoke truth source and keeps journal migration compatible with existing stored objects.

Invariants and assumptions:
- Stale past `nextWakeAt` values must not trigger immediate re-alarms after the previous alarm already fired.
- Missing native runner control tokens must fail closed before the namespace/container is invoked.
- New transient journal prefixes must still coexist with legacy key reads.
- Checked-in/local Wrangler config should not reintroduce `secrets.required` filtering for optional local provider vars.

Verification evidence already run:
- `pnpm --dir apps/cloudflare verify` -> passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts --no-coverage --maxWorkers 1` -> passed.

Direct scenario proof already run:
- Rendered deploy config shows `instance_type: "basic"` and no `secrets.required`.
- Mocked smoke progression requires queue drain + `lastRunAt` advance + bundle refs before success.

Important instruction:
- If current tests already cover the highest-risk deltas well enough, say so explicitly instead of inventing low-value additions.
- If you do find a meaningful missing test, implement the smallest high-impact addition in-scope, run the narrowest relevant verification command, and report exactly what changed.

Output:
- Return only the copy/paste-ready prompts requested by `agent-docs/prompts/test-coverage-audit.md`.
