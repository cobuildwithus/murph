# Fix hosted-local Linq typing runner env and prove it in e2e

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make runner-owned hosted Linq typing use the ambient host-reachable env in hosted-local mode, then add explicit Linq typing assertions so local e2e catches typing regressions instead of only message delivery failures.

## Success criteria

- Runner-owned messaging activity no longer rewrites hosted-local `LINQ_API_BASE_URL` to the container bridge host before starting Linq typing.
- Hosted-local Linq first-contact/reply e2e captures typing requests and proves typing starts before the outbound reply send.
- Focused verification for the touched Cloudflare slice is green, or any unrelated pre-existing failure is identified explicitly.
- Required completion audits run before handoff, and the final scoped commit contains only this task's files plus plan/ledger closeout.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner/runner-run-processor.ts`
  - hosted-local Linq e2e helpers/tests under `apps/cloudflare/test/**`
  - directly coupled Cloudflare node/e2e tests
  - plan/ledger bookkeeping for this task
- Out of scope:
  - production Linq/iMessage provider behavior outside the local repro harness
  - broader hosted typing ownership changes in `packages/assistant-runtime`
  - unrelated active Cloudflare/runtime rows already in the tree

## Constraints

- Preserve unrelated dirty-tree edits and active overlapping Cloudflare rows.
- Keep the fix scoped to runner typing env selection plus Linq local e2e observability.
- Treat local logs and stub payloads as sensitive; do not copy personal identifiers or secrets into repo files or handoff.

## Risks and mitigations

1. Risk: using the ambient env for runner typing could diverge from the real container env in non-local flows.
   Mitigation: keep the change limited to runner-owned messaging activity only; the container invocation path continues to use the container-rewritten env.

2. Risk: the Linq local stub may still hide timing/order bugs even after recording `/typing`.
   Mitigation: mirror the Telegram test structure and assert ordering within the observed request stream.

3. Risk: active overlapping Cloudflare rows may already be changing nearby runner files.
   Mitigation: keep the diff narrow, read the existing file carefully before edit, and commit only the scoped slice.

## Tasks

1. Register the active plan and ledger row.
2. Patch runner messaging activity env resolution to use the ambient hosted runner env.
3. Add or update focused tests proving Linq typing happens before reply send.
5. Run truthful scoped verification, required audits, and finish through the scoped commit flow.

## Decisions

- Runner-owned hosted-local typing should use `buildHostedRunnerAmbientEnv()`; only the real container invocation path should keep the container-rewritten env.
- The Linq hosted-local direct-reply e2e is the highest stable local boundary for this regression, so the new proof asserts observed `POST /typing` before the outbound `/messages` send there instead of widening into lower-level helper-only checks.

## Verification

- Commands run:
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-runner test/runner-run-processor.test.ts --no-coverage` ✅
  - `env -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --testNamePattern 'sends a Linq reply after a later inbound Linq message' --no-coverage` ✅
  - `pnpm --dir apps/cloudflare typecheck` ⚠️ blocked by unrelated `packages/core/src/vault.ts:1003` `TS2322`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts` ⚠️ blocked by the same unrelated `packages/core/src/vault.ts:1003` `TS2322`
  - `git diff --check`
  - required `coverage-write` audit pass ✅ no extra proof needed beyond the narrowed unit/e2e additions; one test-only reflective-call cleanup landed in `apps/cloudflare/test/runner-run-processor.test.ts`
  - required `task-finish-review` audit pass ✅ no findings
- Direct scenario proof to capture:
  - Captured via a debug rerun to a temp log: the runner hit `http://127.0.0.1:<port>/chats/chat_local_1/typing` and logged `Hosted Linq typing indicator started.` before the outbound send
Completed: 2026-04-23
