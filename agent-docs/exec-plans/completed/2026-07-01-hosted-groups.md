Goal (incl. success criteria):
- Land the supplied hosted groups implementation on an isolated branch and open a PR.
- Preserve the intended architecture: group membership is not health-data sharing; `HostedVaultShare` remains the actual data-sharing grant; `HostedThreadContainer` / `HostedThreadRoute` remain routing/runtime primitives.
- Success means the patch is reconciled with current `main`, verified, committed, pushed, opened as a PR with the required intent contract, and sent through the PR ReviewGPT loop until zero accepted findings or a concrete blocker.

Constraints/Assumptions:
- Favor deletion, direct ownership, and existing primitives over broad new managers or speculative state.
- Preserve hosted web as product/control-plane owner and Cloudflare as thin execution runner.
- Keep group runtime access and share grants bound to durable member/group/share authority.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Use the PR-lane ReviewGPT loop as the audit gate for this isolated worktree, per completion workflow.
- Treat the supplied patch as behavioral intent; simplify or adjust it if current repo invariants require changes.

State:
- Implementation verified locally; ready for scoped commit and PR.

Done:
- Read the supplied brief and confirmed the patch applies cleanly to current `origin/main`.
- Created the isolated `codex/hosted-groups` worktree/branch.
- Applied the hosted groups patch and reconciled it with current Prisma, TypeScript, and privacy-baseline guards.
- Added focused coverage for the hosted group runtime tool, parser contract, and vault-share active-runtime gate.
- Passed focused web tests and the full diff verification.

Now:
- Commit the verified branch, push it, and open the PR.

Next:
- Run the external ReviewGPT PR loop and address accepted findings until clean or blocked.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `<HOME_DIR>/Downloads/hosted-groups-implementation-git.patch`
- apps/web/prisma/schema.prisma
- apps/web/app/groups/join/[joinCode]/**
- apps/web/app/api/groups/join/[joinCode]/accept/route.ts
- apps/web/src/lib/hosted-groups/**
- apps/web/src/lib/hosted-vault-share/share-grant-store.ts
- apps/web/src/lib/hosted-mailbox/runtime-access.ts
- apps/web/src/lib/hosted-privacy/account-data-service.ts
- packages/assistant-engine/src/assistant*/**
- packages/assistant-runtime/src/**
- packages/hosted-execution/src/**
- apps/cloudflare/src/**
- `pnpm typecheck`
- `pnpm --dir apps/web test:prepared test/hosted-group-tool.test.ts test/vault-share-deliver-route.test.ts`
- `pnpm --dir apps/web test:prepared test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `pnpm --dir packages/hosted-execution test -- parsers.test.ts`
- `pnpm test:diff`
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
