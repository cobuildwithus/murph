# Hosted Runner Timeout Budget

## Goal

Raise the default Cloudflare hosted runner invocation timeout from 2 minutes to 10 minutes so complex hosted assistant turns have enough wall-clock budget to finish before the worker reports `runner_http_error` / `HOSTED_RUN_RUNTIME_BACKPRESSURED`.

Success criteria:

- Default deploy/runtime config renders `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS=600000`.
- Hosted-web/control callbacks keep the shorter `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=120000` default.
- Operator docs mention the 10-minute default.
- Focused Cloudflare tests that assert timeout defaults are updated and passing.

## Constraints

- Keep this to the hosted Cloudflare runner timeout budget.
- Do not change hosted-web ingress, hosted assistant prompts, provider behavior, message payloads, or retry semantics in this slice.
- Do not log message text, member ids, phone numbers, chat ids, provider payloads, or credentials.
- Preserve unrelated dirty-tree work and active hosted rows.

## Key Decisions

- Only the runner invocation timeout default changes; commit timeout stays `30000`.
- Hosted-web control-plane and email-ingress callback waits use a separate `120000` default so the 10-minute runner budget does not widen public/control-plane wait windows.
- The active stale-run recovery window remains unchanged in this slice.
- The larger UX fix should split durable ingested/remembered conversation cursor from execution/resolution state, so timed-out seqs remain prompt context and later messages can proceed with checkpointed side-effect safety.

## State

completed; archived without commit because overlapping dirty Cloudflare and ledger work prevents a safe scoped commit

## Done

- Confirmed production symptom: hosted seq work timed out around the current 120-second budget.
- Checked Cloudflare Workers limits page for wall-time shape: HTTP and Durable Object RPC/HTTP are not hard-capped while the caller remains connected; alarms/cron/queues are 15 minutes.
- Updated Cloudflare worker runtime fallback, rendered wrangler default, deploy automation default, operator docs, and focused timeout/default tests to `600000`.
- Split hosted-web control-plane/email-ingress callback waits to `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=120000` / `CF_WEB_CONTROL_TIMEOUT_MS=120000`.
- `pnpm --dir apps/cloudflare typecheck` passed after the split.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/env.test.ts apps/cloudflare/test/container-image-contract.test.ts` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/deploy-automation.test.ts -t "builds a generated wrangler config"` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-run-processor.test.ts` passed after adding active-run freshness proof.
- Direct workflow readback found `CF_WEB_CONTROL_TIMEOUT_MS: ${{ vars.CF_WEB_CONTROL_TIMEOUT_MS }}`.
- `git diff --check` passed for the timeout touched paths.

## Now

- None.

## Next

- Follow up separately on ingested-vs-resolved cursor decoupling and timeout retry/stale-run behavior.

## Open Questions

- Whether retry/stale-run recovery should be tightened separately for timeout failures is out of scope for this timeout-budget slice.

## Working Set

- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/scripts/deploy-automation/environment.ts`
- `apps/cloudflare/test/{env,container-image-contract}.test.ts`
- `apps/cloudflare/{README,DEPLOY}.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
