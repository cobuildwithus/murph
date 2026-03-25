Goal (incl. success criteria):
- Mirror CodexBar's local Codex account detection closely enough that Healthy Bob onboarding can persist the configured Codex account tier and current quota metadata when a user chooses a Codex-backed assistant preset.
- Success means setup stores a provider-agnostic assistant account snapshot that can record subscription/API-key style metadata, and Codex presets populate it from local machine state without persisting secrets.

Constraints/Assumptions:
- Keep the change scoped to local onboarding/operator-config persistence plus focused runtime/test updates; do not broaden assistant execution semantics unnecessarily.
- Do not store raw OAuth tokens, API keys, cookie headers, or other secrets.
- Prefer the same local discovery order CodexBar uses where it is practical in Healthy Bob: auth-file JWT parsing first, then Codex CLI RPC enrichment when available.

Key decisions:
- Add a dedicated setup-time assistant account probe layer instead of baking Codex-specific logic into `setup-assistant.ts`.
- Persist the detected account snapshot in a provider-agnostic shape under assistant defaults so future providers or API-key accounts can reuse it.
- Treat Codex quota metadata as window percentages plus credits balance, not as token counts, because that is what the local Codex sources actually expose.

State:
- completed

Done:
- Read the repo guidance, setup/onboarding implementation, and current operator-config persistence path.
- Cloned and inspected CodexBar to confirm its Codex detection paths: `auth.json` JWT parsing, Codex app-server `account/read`, Codex app-server `account/rateLimits/read`, and optional web-dashboard enrichment.
- Added a provider-agnostic assistant account snapshot schema plus Codex-specific local detection/persistence wiring for setup defaults.
- Added focused tests covering auth.json plan parsing, auth+RPC snapshot merging, persisted operator-config metadata, and runtime config compatibility.
- Ran focused CLI verification on the touched setup/runtime paths and reran the repo-required commands to confirm the remaining failures are unrelated pre-existing issues elsewhere in the worktree.

Now:
- Archive this completed plan, remove the active coordination row, and commit the scoped file set.

Next:
- No further implementation planned for this slice unless follow-up UI surfaces are requested.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any downstream UI or CLI surface should immediately render the stored subscription/quota metadata, or whether persistence-only is enough for this turn.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-25-codex-subscription-onboarding.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/operator-config.ts`
- `packages/cli/src/setup-assistant.ts`
- `packages/cli/src/setup-cli-contracts.ts`
- `packages/cli/src/setup-services.ts`
- `packages/cli/src/setup-assistant-account.ts`
- `packages/cli/test/setup-cli.test.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- `git clone --depth 1 https://github.com/steipete/codexbar /tmp/codexbar`
Status: completed
Updated: 2026-03-25
Completed: 2026-03-25
