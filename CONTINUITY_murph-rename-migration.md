Goal (incl. success criteria):
- Finalize the live rename hard-cut so active product/repo/runtime surfaces are `murph` only, while leaving immutable historical snapshots untouched.

Constraints/Assumptions:
- Follow the existing migration brief in `agent-docs/exec-plans/active/2026-03-27-murph-rename-migration.md`.
- Keep completed execution plans immutable.
- Do not expose personal identifiers or secret env contents.
- Preserve unrelated dirty worktree edits.
- Required repo verification remains `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

Key decisions:
- Hard-cut live package namespace/imports to `@murph/*`.
- Primary CLI package/bin is `murph` only.
- Use `.murph` paths and `murph.*` durable ids only in active codepaths.
- Prefer neutral external header/cookie/env names over new branded prefixes.
- Historical completed plans remain unchanged.

State:
- In progress; the final legacy-removal sweep is landing, and wrapper verification is still subject to unrelated shared-tree failures.

Done:
- Read repo guidance and migration brief.
- Loaded coordination ledger and required durable docs.
- Froze implementation assumptions for this pass.
- Replaced live package names/imports with `@murph/*` and `murph`.
- Reintroduced subagents in read-only audit mode after the shared-tree worker attempt produced only coordination churn.
- Completed required audit passes: `simplify`, `test-coverage-audit`, and `task-finish-review`.
- Re-ran focused verification for `packages/cli/test/assistant-service.test.ts` and `packages/cli/test/setup-cli.test.ts`.
- Re-ran repo wrappers and confirmed `pnpm typecheck` now passes.
- Follow-up hard-cut the visible CLI surface to `murph` only by removing the published alias and compatibility detection from setup.
- Began removing the remaining legacy path/schema/runtime fallbacks, hosted compatibility parsers, and legacy-only tests/docs from the active tree.

Now:
- Finish the remaining active-tree legacy removal, rerun focused verification, and send the required audit passes for this follow-up.

Next:
- Commit the legacy-removal follow-up with notes for any unrelated shared-tree wrapper failures that remain after reruns.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any hosted external key names are contractually fixed outside the repo and therefore must stay neutral-but-unchanged.
- UNCONFIRMED: the cleanest safe way to derive the exact migration-owned commit file list from the heavily shared dirty tree without sweeping unrelated lanes.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-27-murph-rename-migration.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_murph-rename-migration.md`
- `packages/cli/src/{assistant/onboarding.ts,assistant-cli-contracts.ts,operator-config.ts,setup-services/shell.ts}`
- `packages/cli/src/setup-services.ts`
- `packages/runtime-state/src/*.ts`
- `packages/web/{src/lib/vault.ts,test/overview.test.ts}`
- `apps/cloudflare/src/{crypto.ts,hosted-email.ts,user-env.ts}`
- `scripts/{package-data-context.sh,setup-host.sh}`
- `packages/cli/test/{assistant-service.test.ts,setup-cli.test.ts}`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
