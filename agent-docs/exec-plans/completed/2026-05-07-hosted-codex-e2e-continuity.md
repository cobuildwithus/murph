Goal (incl. success criteria):
- Make hosted-local E2E Codex continuity match production snapshot expectations.
- Success means full-stack Linq/Telegram scenarios cannot run the Codex E2E shim in legacy non-rollout mode, and focused E2E proof no longer fails with missing required rollout state.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active plan rows.
- Do not expose user identifiers, secrets, raw credentials, home paths, or local usernames in logs, docs, commits, or handoff.
- Keep provider/channel HTTP stubs only at external boundaries; internal Codex/runtime/snapshot contracts should stay production-shaped.
- Running the real Codex app server directly may require credentials and live provider behavior, so the immediate fix should remove fake continuity shape rather than add live external dependencies to CI.

Key decisions:
- Prefer deleting/defaulting away from legacy shim continuity over adding another forwarded test-only flag.

State:
- Diagnosed failure: full-stack hosted-local E2Es use the Codex shim through the runner env profile path, but the rollout-capable shim mode is gated by `HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_UUID_THREADS`.
- The runner assistant env profile forwards the stub base URL and turn delay but not the UUID-thread flag, so the shim can produce sessions without a valid rollout path.
- Implemented default rollout-shaped shim behavior. The rebuilt Linq delivery E2E no longer fails with missing required rollout state.
- The first full rerun exposed a separate assertion mismatch: file-backed rollout resume restores the raw structured assistant decision in Codex history, not the old plain-text-only marker history.
- Focused and diff-aware verification passed. A full `all --no-bundle` run had one invalid failure because it reused a Linq-delivery bundle without parser toolchain for the Linq webhook audio case; rebuilding/rerunning `linq-webhook` with normal bundle prep passed.

Done:
- Traced the fatal assertion in hosted bundle snapshot collection.
- Compared checkpoint-baseline's rollout-capable test setup to full-stack Linq/Telegram scenario setup.
- Removed the legacy shim mode and updated focused assistant-runtime coverage.
- Updated the Linq prompt-history assertion to accept production-shaped structured assistant history.
- Ran focused assistant-runtime tests, hosted-local Linq delivery, hosted-local Linq webhook with parser bundle, and scoped `pnpm test:diff`.

Now:
- Final diff review and closeout.

Next:
- Handoff with verification evidence.

Open questions (UNCONFIRMED if needed):
- Whether the remaining hosted runtime log redacted JSON failure is fully downstream of the continuity error or needs a separate active-plan fix.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-*.ts`
- `pnpm hosted-local e2e linq-delivery --no-bundle`
- `pnpm hosted-local e2e linq-webhook`
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
