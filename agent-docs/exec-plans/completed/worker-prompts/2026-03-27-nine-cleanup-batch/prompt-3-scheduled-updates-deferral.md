Murph cleanup lane: simplify the stale onboarding scheduled-updates path without changing behavior.

Ownership:
- Own `packages/cli/src/{setup-services.ts,setup-services/scheduled-updates.ts,assistant/cron/presets.ts,setup-cli-contracts.ts}`.
- Own direct coverage in `packages/cli/test/{setup-cli.test.ts,assistant-cron.test.ts,assistant-cli.test.ts}`.
- `packages/cli/src/setup-services.ts` is already dirty. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Relevant code:
- `packages/cli/src/setup-services/scheduled-updates.ts`: `configureSetupScheduledUpdates`, `resolveSelectedScheduledUpdates`, `toAssistantCronPreset`
- `packages/cli/src/assistant/cron/presets.ts`: `listAssistantCronPresets`, `getAssistantCronPresetDefinition`, `stripPromptTemplate`
- `packages/cli/src/setup-services.ts`: current call site
- `packages/cli/src/setup-cli-contracts.ts`: `SetupScheduledUpdate` and step-status types

Issue:
- The onboarding "scheduled updates" service is now a deferred-recommendation path, not an installer, but the code still looks like an old configuration path:
  - `configureSetupScheduledUpdates` is async even though it does not await
  - the input includes `vault` but the function never uses it
  - all returned `SetupScheduledUpdate` entries are `status: "skipped"`
  - the local `toAssistantCronPreset` projection duplicates `stripPromptTemplate`
  - names like `configured` suggest installation even though behavior is always "defer until later"

Best concrete fix:
- Keep the external behavior exactly the same, but simplify internals.
- Reuse a single preset-definition to `AssistantCronPreset` projection helper instead of duplicating `toAssistantCronPreset`.
- Rename internal variables to reflect deferred recommendations rather than installation.
- Remove obviously dead internal pieces like the unused `vault` input only if that is package-internal only.
- Remove `async` only if that does not cross a meaningful external API boundary; otherwise leave the signature and simplify internals only.

Do not change:
- result shape
- status values
- ordering or deduping of preset ids
- the current "install later with assistant cron preset install --channel ..." guidance
- unknown preset error behavior

If changing an exported function signature or input type would be externally visible, report that as risky instead of applying it.

Tests to anchor:
- `packages/cli/test/setup-cli.test.ts`
- `packages/cli/test/assistant-cron.test.ts`
- `packages/cli/test/assistant-cli.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
