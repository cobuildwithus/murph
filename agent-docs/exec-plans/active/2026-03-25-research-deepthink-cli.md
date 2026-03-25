Goal (incl. success criteria):
- Integrate the supplied `research` and `deepthink` CLI patch onto the current repo snapshot without overwriting unrelated in-flight edits.
- Expose typed command contracts, assistant guidance, and cron-preset nudges for the new research flows.
- Persist saved research notes through the canonical core write path and cover the new runtime helpers with focused tests.

Constraints/Assumptions:
- The worktree is already dirty, including several files that overlap this patch.
- Keep the change scoped to the research/deepthink command surface, assistant guidance copy, docs, and focused tests.
- Port the supplied patch behavior manually where current files have drift instead of forcing stale hunks.
- Preserve the existing core-only canonical mutation boundary and generated incur topology expectations.

Key decisions:
- Treat the supplied patch as the behavioral target, but merge it manually on top of the live tree where overlapping files already differ.
- Reuse `applyCanonicalWriteBatch` from the integrated core runtime instead of adding ad hoc CLI file writes.
- Keep the assistant guidance change limited to telling the agent when to use `research` or `deepthink`; do not broaden unrelated assistant behavior in this lane.

State:
- completed

Done:
- Read the repo routing/process docs and inspected the supplied patch contents.
- Confirmed overlapping in-flight edits in assistant guidance and generated CLI files that require a careful merge instead of a blind patch apply.
- Registered the active coordination lane for this work.
- Added the `research` and `deepthink` root commands, runtime wrappers, command contracts, assistant guidance updates, default-vault injection coverage, and focused regression tests.
- Hardened the new runtime error path so missing-workspace failures no longer echo the raw research prompt in error context and process-failure metadata redacts `--prompt` values.
- Ran focused Vitest coverage for the new runtime/helpers and the affected assistant/CLI guidance surfaces.
- Ran the required repo checks and captured the current unrelated blockers.

Now:
- Remove the active ledger row and commit the scoped file set with the recorded verification results.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the broader in-flight `intervention` and repo-hygiene lanes will land before or after this research/deepthink commit; the touched generated/manual files now overlap those lanes and must be called out during handoff.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-25-research-deepthink-cli.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `git apply --check --3way <supplied patch>`
- targeted `packages/cli/src/*`, `packages/cli/test/*`, and `docs/contracts/03-command-surface.md`
- required checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- focused verification:
  - `pnpm exec vitest run packages/cli/test/research-runtime.test.ts packages/cli/test/assistant-cli-access.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1 -t "assistant cron preset list/show/install expose built-in templates and materialize jobs through the CLI|root chat alias participates in default-vault injection|default-vault root coverage stays aligned with manifest-backed root commands"`
