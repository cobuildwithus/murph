You are Codex Audit Worker HB operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker HB` only if you need to edit files; review-only is preferred.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the required completion-workflow final review audit for the hosted bootstrap and hosted user-env boundary change.
- Read and follow `agent-docs/prompts/task-finish-review.md` exactly.

Review boundary:
- Final regression/correctness/security/state-transition review only.
- Do not revert adjacent dirty work.
- Do not propose broad redesign beyond issues directly exposed by this change.

Review scope:
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `apps/cloudflare/src/bundle-store.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/user-env.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- `apps/cloudflare/test/user-runner.test.ts`
- `apps/cloudflare/test/user-env.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `ARCHITECTURE.md`
- `apps/cloudflare/README.md`
- `packages/runtime-state/README.md`
- `agent-docs/index.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`
- Any directly affected call paths needed to assess regressions or invariants.

Audit handoff packet:
- What changed: hosted bootstrap is now explicit on `member.activated`; ordinary hosted events require an already bootstrapped member context and do not silently create the vault or mutate assistant config. Hosted per-user env overrides moved out of the broader `agent-state` bundle into a separate encrypted object keyed per user and injected at runner start.
- Why this fits: it removes hidden configuration mutation from ordinary hosted event runs, reduces `agent-state` bundle churn, and preserves the existing worker -> DO -> container -> commit/finalize flow and explicit hosted side-effect handling.
- Invariants: no plaintext env in DO state; `agent-state` still excludes vault `.runtime/**`; activation bootstrap remains idempotent; repeated activation reuses existing state; non-activation empty-bundle runs fail fast; env allowlist behavior stays intact; separate env writes do not churn `agent-state`.
- Relevant files: `packages/assistant-runtime/src/hosted-runtime.ts`, `apps/cloudflare/src/{bundle-store.ts,node-runner.ts,user-env.ts,user-runner.ts,user-runner/runner-bundle-sync.ts}`, `packages/runtime-state/src/hosted-bundles.ts`, `apps/cloudflare/test/{node-runner.test.ts,user-runner.test.ts,user-env.test.ts,index.test.ts}`, `packages/runtime-state/test/hosted-bundle.test.ts`, docs in `ARCHITECTURE.md`, `apps/cloudflare/README.md`, `packages/runtime-state/README.md`, `agent-docs/{index.md,operations/verification-and-runtime.md,references/testing-ci-map.md}`.

Verification evidence already run and passed:
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/user-env.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/index.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config vitest.config.ts --coverage.enabled=false packages/runtime-state/test/hosted-bundle.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/node-runner.test.ts`

Additional targeted proof:
- Node-runner tests cover first activation bootstrap, repeated activation idempotence, follow-up non-activation reuse, and rejection of non-activation empty-bundle runs.

Broader repo wrapper status:
- `pnpm test` and `pnpm test:coverage` are blocked by an unrelated tracked `apps/web/postcss.config.mjs`.
- `pnpm typecheck` is blocked by unrelated errors in `packages/parsers`.
- `pnpm --dir apps/cloudflare test:node` is blocked by unrelated errors in `packages/cli/src/index.ts` and `packages/runtime-state/src/device-sync.ts`.

Output:
- Return only the copy/paste-ready prompts requested by `agent-docs/prompts/task-finish-review.md`.
