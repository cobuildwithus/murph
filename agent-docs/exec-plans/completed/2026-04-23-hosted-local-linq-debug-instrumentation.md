# Restore hosted-local Linq seed imports and add narrow typing diagnostics

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Restore the hosted-local Linq end-to-end lane so its seed helpers load reliably under the current test runtime.
- Add narrow runner/container typing diagnostics that distinguish typing-attempt timing from container start timing without changing hosted typing ownership behavior.

## Success criteria

- The focused hosted-local Linq e2e no longer fails during seed setup because of dynamic import resolution in the `apps/web` test helpers.
- Targeted hosted typing logs record runner typing start attempt/result timing plus container start mode/readiness timing for the same run.
- Verification covers the touched `apps/web`, `apps/cloudflare`, and `packages/assistant-runtime` slices truthfully, or any unrelated pre-existing failure is called out explicitly.
- Required completion audits run before handoff, and the final scoped commit contains only this task's files plus plan/ledger closeout.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts`
  - `apps/web/src/lib/hosted-ingress/hosted-ingress-test-seed.ts`
  - `packages/assistant-runtime/src/hosted-runtime/typing.ts`
  - `apps/cloudflare/src/runner-container.ts`
  - directly coupled focused tests in `apps/cloudflare/test/**` and `packages/assistant-runtime/test/**`
  - plan/ledger bookkeeping for this task
- Out of scope:
  - broader hosted typing ownership redesigns
  - changes to provider APIs or iMessage/Linq product behavior
  - unrelated active hosted messaging lifecycle or retention work

## Constraints

- Preserve unrelated dirty-tree edits, especially the active hosted typing and hosted observability rows touching nearby Cloudflare files.
- Keep instrumentation narrow and structured; do not add noisy logs or broad behavioral changes.
- Avoid writing personal identifiers or secrets into logs, tests, docs, commits, or handoff text.

## Risks and mitigations

1. Risk: the seed-helper fix could paper over an environment issue instead of restoring a stable import path.
   Mitigation: keep the change to explicit importable module specifiers only and prove it by rerunning the exact failing e2e lane.

2. Risk: instrumentation edits could conflict with already-dirty hosted typing files.
   Mitigation: inspect the current file state before patching, keep the diff additive, and stage only the task-owned logging hunk in `typing.ts`.

3. Risk: the focused e2e lane may still not reproduce a real cold container locally.
   Mitigation: treat the new logs as diagnosis support, not as proof of the full production issue, and call out any remaining local fidelity gap explicitly.

## Tasks

1. Register the active plan and ledger row. Done.
2. Patch the `apps/web` hosted seed helpers to use stable importable specifiers. Done.
3. Rerun the focused hosted-local Linq e2e lane to confirm the seed regression is gone. Done.
4. Add narrow runner/container typing diagnostics in the existing assistant-runtime and Cloudflare seams. Done.
5. Run truthful scoped verification, required audits, and finish through the scoped commit flow. Done with a manual scoped commit because `finish-task` would have swept overlapping `typing.ts` changes from another active row.

## Decisions

- Keep the runtime behavior unchanged for now; this task is for restoring local repro and improving diagnosis signal.
- Commit only the task-owned logging hunk in `packages/assistant-runtime/src/hosted-runtime/typing.ts`; leave the overlapping post-delivery typing-stop helper for its owning row.

## Verification

- Commands run:
  - `pnpm typecheck`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-typing.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts test/hosted-local-linq-first-contact-e2e.test.ts --testNamePattern 'sends a Linq reply after a later inbound Linq message' --no-coverage`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts apps/web/src/lib/hosted-ingress/hosted-ingress-test-seed.ts packages/assistant-runtime/src/hosted-runtime/typing.ts packages/assistant-runtime/test/hosted-runtime-typing.test.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts`
  - `git diff --check -- apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts apps/web/src/lib/hosted-ingress/hosted-ingress-test-seed.ts packages/assistant-runtime/src/hosted-runtime/typing.ts packages/assistant-runtime/test/hosted-runtime-typing.test.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/exec-plans/active/2026-04-23-hosted-local-linq-debug-instrumentation.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Outcomes:
  - `pnpm typecheck`: passed.
  - Focused `packages/assistant-runtime` typing test: passed.
  - Focused `apps/cloudflare` runner-container test: passed.
  - Focused hosted-local Linq direct-reply e2e: passed twice after the seed-helper fix.
  - Streamed local proof with `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS=1000` showed runner-owned Linq typing start requested/started before a forced cold container start/ready on the direct-reply run.
  - `bash scripts/workspace-verify.sh test:diff ...`: failed in unrelated existing `apps/cloudflare/test/node-runner.test.ts` messaging-activity callback/fetch expectations outside this diff.
  - `git diff --check`: passed.
  - Required `coverage-write`: no additional edits needed.
  - Required `task-finish-review`: no blocking findings.

Final outcomes:
- The hosted-local Linq seed-loader regression is fixed.
- The local diagnosis improved: forcing a cold shell still shows runner typing start before the container is ready, which argues against cold-container typing ownership handoff as the primary cause of the production iMessage symptom.
Completed: 2026-04-23
