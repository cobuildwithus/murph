Goal (incl. success criteria):
- Fix PR 143 review feedback for hosted-local Codex subscription auth before merge.
- Success means the runner seed uses the correct external-token auth mode, both host and runner validate one strict seed contract, malformed refresh results fail before runner startup, and focused tests prove the reviewed failure cases.
Constraints/Assumptions:
- Keep the durable host refresh grant host-side only; runner seed must not contain a managed refresh token.
- Preserve hosted-local/dev-only boundary and avoid broad auth/runtime refactors.
- Preserve unrelated active-work rows.
Key decisions:
- Use one shared parser/builder seam for the hosted-local Codex subscription seed shape.
State:
- Active.
Done:
- Read required repo workflow, architecture, security, reliability, and verification docs.
- Confirmed PR 143 head is `hosted-local-dev-codex-subscription`.
- Added hosted-execution shared hosted-local Codex subscription auth parser/builder.
- Changed runner seed auth mode to `chatgptAuthTokens` with required `account_id` and `last_refresh`.
- Tightened host refresh handling so HTTP 200 without a new access token fails.
- Added strict seed/host parsing for parseable ID-token JWT payloads and UTC RFC3339 `last_refresh`.
- Focused auth tests pass for hosted-execution, hosted-local-harness, and assistant-runtime.
- `security-privacy-review` found no medium-or-higher security issues.
- `coverage-write` added proof for refresh responses that return a token too close to expiry.
- `task-finish-review` findings were fixed; re-check found no remaining high/medium issue.
Now:
- Run final policy checks and close the plan with a scoped commit.
Next:
- Push the scoped commit to the PR branch.
Open questions (UNCONFIRMED if needed):
- Live `pnpm dev` subscription-auth smoke requires real subscription credentials and remains a human verification gap.
Working set (files/ids/commands):
- `packages/hosted-local-harness/src/dev-hosted-local/codex-subscription-auth.ts`
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- `packages/hosted-local-harness/test/dev-hosted-local/codex-subscription-auth.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution.test.ts` passed
- `packages/hosted-execution/src/hosted-codex-subscription-auth.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts`
- `tsconfig.base.json`
- `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts --no-coverage test/dev-hosted-local/codex-subscription-auth.test.ts test/dev-hosted-local/stack.test.ts` passed
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts` passed
- `pnpm --dir packages/hosted-execution typecheck` passed
- `pnpm --dir packages/hosted-local-harness typecheck` passed
- `pnpm typecheck` and `pnpm test:diff ...` are blocked by existing `packages/assistant-cli` workspace type-resolution/type errors.
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
