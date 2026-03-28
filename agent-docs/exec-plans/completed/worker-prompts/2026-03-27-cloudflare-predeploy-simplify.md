You are Codex Audit Worker CF-S operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker CF-S` only if you need to edit files; review-only is preferred.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the required completion-workflow simplify audit for the Cloudflare pre-deploy fixes.
- Read and follow `agent-docs/prompts/simplify.md` exactly.

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
- Closed the remaining Cloudflare hosted-runner pre-deploy gaps without changing the overall architecture.
- Cleared stale `nextWakeAt` state at alarm start and only reused explicit future wake hints so already-fired alarms do not self-loop.
- Pinned native-container sizing in both checked-in and generated Wrangler config.
- Strengthened smoke verification so `/run` must drain the queue, advance `lastRunAt`, and expose durable bundle refs before passing.
- Moved transient execution-journal and side-effect journal objects under top-level transient prefixes and now delete execution-journal entries after a committed dispatch is durably applied.
- Removed checked-in/local Wrangler `secrets.required` filtering so optional provider vars in local `.dev.vars` are not silently excluded.
- Tightened native container control-token handling so runner invocation fails closed when the token is unset.

Why this implementation fits the current system:
- It preserves the Worker + Durable Object + Cloudflare `Container` design already chosen for hosted execution.
- It keeps legacy journal key reads compatible while making new transient writes lifecycle-friendly.
- It keeps the smoke assertions aligned with the operator-facing status surface that already exists instead of inventing a separate deploy probe.

Invariants and assumptions:
- Hosted runner control calls stay on the internal Worker/container boundary and must fail closed when control tokens are missing.
- Legacy execution-journal and side-effect journal keys must remain readable during migration.
- Queue draining must not re-arm itself from stale past wake timestamps.
- The scope is bounded to the files above; do not chase unrelated dirty worktree changes.

Verification evidence already run:
- `pnpm --dir apps/cloudflare verify` -> passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts --no-coverage --maxWorkers 1` -> passed.

Direct scenario proof already run:
- Rendered deploy config shows `instance_type: "basic"` and omits `secrets.required`.
- The smoke helper was exercised against mocked status progression and only passed after queue drain, `lastRunAt` advancement, and durable bundle refs became available.

Output:
- Return only the copy/paste-ready prompts requested by `agent-docs/prompts/simplify.md`.
