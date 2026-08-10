Goal (incl. success criteria):
- Make hosted automation scheduling preserve an explicitly requested IANA timezone instead of forcing the model to encode a foreign wall-clock time into the vault-local cron.
- Return enough authoritative timing data from `murph.automation` for the assistant to verify the saved schedule before confirming it.
- Success means an Eastern-time vault can save a daily 9 PM Central automation whose next occurrence is 02:00Z, omitted timezones still follow the vault, DST behavior remains correct, and the exact pushed PR head passes focused proof, required CI, preliminary ReviewGPT specialists, and the final ReviewGPT gate.

Constraints/Assumptions:
- `@murphai/contracts` remains the single schedule-shape owner; do not create a hosted-only duplicate schedule schema or hidden timezone tag.
- Existing recurring automations without an explicit timezone must retain current vault-local behavior.
- One-shot `at`, interval `every`, and device-activity schedules remain timezone-free.
- Keep current route, authorization, finite-window, retry, and delivery behavior unchanged.
- Treat production reports and conversation evidence as confidential; tests and docs use synthetic timezone-only scenarios.

Key decisions:
- Add an optional IANA `timeZone` only to recurring `cron` and `dailyLocal` canonical schedules. Omission continues to derive the vault timezone at projection time.
- Persist the explicit timezone with the canonical automation schedule so DST and later vault-timezone changes cannot alter an explicitly named timezone.
- Extend the hosted automation result with the stored schedule, effective timezone, and projected next occurrence instead of relying on model-authored confirmation text.
- Update the existing schedule-owner documentation and focused contract/core/assistant/runtime tests rather than adding a new service or state owner.

State:
- Implementation and focused local proof complete; exact-head PR review pending.

Done:
- Proved the production failure mechanism: a UTC-converted cron hour was persisted and then evaluated in the vault timezone.
- Traced hosted Codex instructions, dynamic tool admission, core persistence, canonical cron projection, and the result serialization blind spot.
- Created an isolated task worktree from current `origin/main`.
- Added optional recurring `timeZone` ownership to the canonical automation contract and preserved it through core writes, query reads, cron projection, and public schedule serialization.
- Added the stored schedule, effective timezone, projected next occurrence, and explicit verification state to hosted automation results; projection failures no longer turn a successful write into a false timing confirmation.
- Updated hosted tool/prompt guidance to keep named wall-clock times intact and confirm them only from verified tool results.
- Added synthetic contract, core, query, cron, hosted-tool, prompt, and runtime regressions. The exact cross-timezone proof projects 9 PM `America/Chicago` to `2026-08-10T02:00:00.000Z` while the vault is `America/New_York`.
- Passed the focused regression files and the complete workspace `pnpm typecheck` across all projects.

Now:
- Measure complete base/head provider-visible input for representative direct and group turns, then freeze the candidate head.

Next:
- Push the exact PR candidate and run preliminary specialists plus the final ReviewGPT gate concurrently with CI.

Open questions (UNCONFIRMED if needed):
- None. The implementation reuses `getAssistantCronJob` for the actual scheduler projection and the existing vault-timezone resolver for legacy schedules that omit `timeZone`.

Working set (files/ids/commands):
- packages/contracts/src/{schedule-intent,automation}.ts
- packages/core/src/automation.ts
- packages/query/src/automation.ts
- packages/assistant-engine/src/assistant/{cron/canonical-jobs,execution-context}.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools/automation.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- focused tests under packages/{contracts,core,assistant-engine,assistant-runtime,operator-config}/test
- agent-docs/references/data-model-seams.md
- pnpm exec vitest run <focused files>
- pnpm typecheck
