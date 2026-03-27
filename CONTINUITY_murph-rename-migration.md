Goal (incl. success criteria):
- Rename live Healthy Bob product/repo/runtime surfaces to `murph` across the active tree without blindly rewriting historical snapshots, while preserving compatibility for durable state and operator-home paths.

Constraints/Assumptions:
- Follow the existing migration brief in `agent-docs/exec-plans/active/2026-03-27-murph-rename-migration.md`.
- Keep completed execution plans immutable.
- Do not expose personal identifiers or secret env contents.
- Preserve unrelated dirty worktree edits.
- Required repo verification remains `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

Key decisions:
- Hard-cut live package namespace/imports to `@murph/*`.
- Primary CLI package/bin becomes `murph`; keep `healthybob` compatibility alias where packaging allows.
- Dual-read legacy `~/.healthybob` paths and durable `healthybob.*` ids where state is user-owned; write `murph.*` names going forward.
- Prefer neutral external header/cookie/env names over new branded prefixes.
- Historical completed plans remain unchanged.

State:
- In progress; migration implementation landed, final wrapper verification still blocked by unrelated shared-tree failures.

Done:
- Read repo guidance and migration brief.
- Loaded coordination ledger and required durable docs.
- Froze implementation assumptions for this pass.
- Replaced live package names/imports with `@murph/*` and `murph`.
- Added core legacy-read support for operator config, assistant state contracts, hosted bundle/user-env/cipher envelopes, and hosted route schemas.
- Reintroduced subagents in read-only audit mode after the shared-tree worker attempt produced only coordination churn.
- Fixed the assistant onboarding migration gap so legacy `healthybob.assistant-onboarding.v1` state is rewritten to `murph.assistant-onboarding.v1` under the onboarding write lock.
- Restored the local setup-managed `healthybob` compatibility shim alongside `murph` and `vault-cli`, matching the package bin compatibility window.
- Completed required audit passes: `simplify`, `test-coverage-audit`, and `task-finish-review`.
- Re-ran focused verification for `packages/cli/test/assistant-service.test.ts` and `packages/cli/test/setup-cli.test.ts`.
- Re-ran repo wrappers and confirmed `pnpm typecheck` now passes.
- Follow-up hard-cut the visible CLI surface to `murph` only by removing the published `healthybob` bin alias, stopping new `healthybob` shim installation, deleting a legacy `~/.local/bin/healthybob` shim during setup reruns, and removing `healthybob` normalization from `detectSetupProgramName`.
- Re-ran focused CLI verification for package shape plus `packages/cli/test/setup-cli.test.ts`.
- Re-ran required audit subagents for the murph-only CLI follow-up; simplify found no issues, and coverage/finish-review findings about legacy shim absence/cleanup were fixed locally.

Now:
- Commit the murph-only CLI follow-up without sweeping unrelated shared-tree changes.

Next:
- Commit the murph-only CLI follow-up with notes that `pnpm test` is currently blocked by repo-wide doc-drift on the dirty working tree and `pnpm test:coverage` is currently blocked by unrelated `apps/web/src/lib/hosted-execution/hydration.ts` type errors in the shared tree.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether npm publish metadata or external consumers require extra `exports`/alias shims beyond the current package/bin compatibility window.
- UNCONFIRMED: whether any hosted external key names are contractually fixed outside the repo and therefore must stay neutral-but-unchanged.
- UNCONFIRMED: the cleanest safe way to derive the exact migration-owned commit file list from the heavily shared dirty tree without sweeping unrelated lanes.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-27-murph-rename-migration.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_murph-rename-migration.md`
- `packages/cli/src/{assistant/onboarding.ts,setup-services/shell.ts}`
- `packages/cli/src/setup-services.ts`
- `packages/cli/package.json`
- `packages/cli/scripts/verify-package-shape.ts`
- `packages/cli/test/{assistant-service.test.ts,setup-cli.test.ts}`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
