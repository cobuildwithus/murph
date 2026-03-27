Goal (incl. success criteria):
- Replace the assistant-only hosted post-commit outbox contract with a generic committed side-effect journal so one-shot hosted runs durably record outbound actions with committed bundles and retries can resume sending from committed state without recomputing the event.

Constraints/Assumptions:
- Keep hosted execution dispatch/event shapes stable.
- Preserve existing assistant outbox files and local CLI semantics.
- Dirty worktree already contains overlapping Cloudflare and assistant-runtime refactors; preserve adjacent edits.
- Residual transport edge remains explicit when an external send succeeds but the sent-marker write back fails.

Key decisions:
- Treat assistant delivery as the first concrete hosted side-effect kind rather than a special-case outbox route.
- Persist committed side effects on the hosted execution journal record itself.
- Resume post-commit retries from committed bundles plus committed side effects instead of rerunning the original hosted compute stage.

State:
- implementation complete; focused verification complete; final commit/handoff in progress

Done:
- Read repo routing docs, the coordination ledger, and the hosted idempotency follow-up.
- Confirmed the current hosted runtime still committed bundles/results first and only journaled assistant deliveries afterward.
- Added a generic hosted side-effect contract plus committed journal field, with assistant delivery as the first concrete effect kind.
- Threaded committed side effects through the hosted runtime commit/finalize flow and the Cloudflare execution journal.
- Added post-commit resume so Durable Object retries drain committed side effects without rerunning the original compute stage.
- Updated targeted Cloudflare/runtime docs and direct regression tests for side-effect journaling, route aliases, and committed-resume retries.
- Ran the mandatory simplify and test-coverage audit subagents; simplified findings were either already satisfied or rejected after direct verification, and the coverage pass added direct resume-path plus canonical/compatibility boundary regressions.
- Re-ran focused verification with `apps/cloudflare/test/{node-runner,index,user-runner}.test.ts` all green plus `packages/cli` typecheck green.
- Re-ran the required root wrappers after coverage updates and recorded unrelated red failures in `packages/contracts`, `packages/assistant-runtime` build graph resolution, and unrelated CLI/query typing.

Now:
- Remove the completed coordination-ledger row, commit the touched files, and hand off the exact focused-green plus unrelated-root-red verification state.

Next:
- If the final-review subagent tooling keeps failing to return a usable result, call that audit-tooling gap out explicitly in handoff instead of pretending the mandatory pass completed.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any current hosted one-shot side effects besides assistant deliveries need first-class effect kinds immediately, or whether the generic framework with assistant as the first kind is sufficient for the current runtime surface.

Working set (files/ids/commands):
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir ../.. exec vitest run apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/user-runner.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1`
- `pnpm --dir ../.. exec tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- `docs/cloudflare-hosted-idempotency-followup.md`
- `packages/assistant-runtime/src/{contracts.ts,hosted-runtime.ts}`
- `apps/cloudflare/src/{execution-journal.ts,index.ts,node-runner.ts,outbox-delivery-journal.ts,runner-outbound.ts}`
- `apps/cloudflare/test/{index.test.ts,node-runner.test.ts,user-runner.test.ts}`
