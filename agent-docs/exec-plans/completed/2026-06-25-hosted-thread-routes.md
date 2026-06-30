Goal (incl. success criteria):
- Land explicit hosted external-thread routing so a bound Linq thread can deliver into a dedicated thread-container runtime.
- Keep the implementation minimal: one hosted thread-container marker, one blind-indexed route table, existing mailbox/runtime wake path, and an explicit per-container monthly usage cap.
- Success means the supplied patch is applied against current `origin/main`, focused route/ingress/usage/privacy tests pass, required repo verification passes, and a PR is opened from the isolated worktree branch.

Constraints/Assumptions:
- Web remains the owner of hosted ingress, mailbox facts, usage gating, privacy export/delete coverage, and Prisma persisted state.
- Do not expose raw external thread ids; store and query only blind-index lookup keys.
- Thread-container runtimes must not inherit a full normal member allowance; use the container marker cap.
- Preserve unrelated active ledger rows and current-checkout work.

Key decisions:
- Treat the user-supplied patch as behavioral intent and repair drift against current `origin/main` rather than forcing stale hunks.
- Use the PR lane, so local completion audit subagents are skipped in favor of the required ReviewGPT PR loop after push.

State:
- Implementation complete; final review/commit pending.

Done:
- Created isolated worktree and branch from `origin/main`.
- Read the required repo workflow, architecture, security, reliability, verification, and PR-review routing docs.
- Applied the hosted external-thread routing patch against current code with drift fixes.
- Ran focused web tests for thread-route store, Linq explicit route planning, usage allowance, migration guard, and existing Linq dispatch/idempotency/usage-reset flows: pass.
- Ran `pnpm --dir apps/web typecheck`: pass.
- Ran `pnpm verify:acceptance`: failed in unrelated package coverage paths under full parallel load:
  - `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` no-progress dirty idle checkpoint assertion saw one fetch request under acceptance load.
  - `packages/cli/test/device-cli.test.ts` local-credentials-absent device provider/account list smoke timed out at 60s under acceptance load.
- Reran both failing tests directly without full acceptance load: pass.

Now:
- Final diff review, finish-task commit, push, PR, and ReviewGPT loop.

Next:
- Push, open PR, and start ReviewGPT loop.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/20260624120000_hosted_thread_routes/migration.sql
- apps/web/src/lib/hosted-onboarding/contact-privacy-core.ts
- apps/web/src/lib/hosted-onboarding/contact-privacy.ts
- apps/web/src/lib/hosted-routing/thread-route-store.ts
- apps/web/src/lib/hosted-routing/thread-container-service.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-execution/usage-allowance.ts
- apps/web/src/lib/hosted-privacy/account-data-service.ts
- apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts
- apps/web/test/hosted-thread-route-store.test.ts
- apps/web/test/hosted-onboarding-linq-thread-route.test.ts
- `pnpm test:diff <touched paths>`
- `pnpm verify:acceptance`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
