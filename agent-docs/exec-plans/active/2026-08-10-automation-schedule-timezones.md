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
- ReviewGPT round-one findings are remediated locally; focused proof passes and the corrected exact head is being prepared for round two and CI.

Done:
- Proved the production failure mechanism: a UTC-converted cron hour was persisted and then evaluated in the vault timezone.
- Traced hosted Codex instructions, dynamic tool admission, core persistence, canonical cron projection, and the result serialization blind spot.
- Created an isolated task worktree from current `origin/main`.
- Added optional recurring `timeZone` ownership to the canonical automation contract and preserved it through core writes, query reads, cron projection, and public schedule serialization.
- Added the stored schedule, effective timezone, projected next occurrence, and explicit verification state to hosted automation results; projection failures no longer turn a successful write into a false timing confirmation.
- Updated hosted tool/prompt guidance to keep named wall-clock times intact and confirm them only from verified tool results.
- Added synthetic contract, core, query, cron, hosted-tool, prompt, and runtime regressions. The exact cross-timezone proof projects 9 PM `America/Chicago` to `2026-08-10T02:00:00.000Z` while the vault is `America/New_York`.
- Passed the focused regression files and the complete workspace `pnpm typecheck` across all projects.
- Rebased the candidate onto current `origin/main` and captured complete first provider-visible input at base `f71addfd9db4` and head `f66c55a20393` with the pinned real Codex App Server, hermetic Responses stub, `gpt-5.6-terra`, low reasoning, production code mode, synthetic ordinary direct/group scheduling turns, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. The canonical capture included `include`, `input`, `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools`, normalized temporary paths, and excluded model selection, reasoning, storage, streaming, service-tier, account, cache, and transport metadata identically.
- Direct initial input changed from 23,701 tokens / 109,497 bytes to 23,816 / 110,027 (+115, +0.4852%, +530 bytes); group changed from 20,173 / 93,946 to 20,288 / 94,476 (+115, +0.5701%, +530 bytes). The complete initial-request delta is the assembled automation timing guidance. The deferred automation description/schema payload itself grows from 4,027 tokens / 12,987 bytes to 4,451 / 14,990 (+424 / +2,003) when loaded, but that deferred payload is not present in the first request.
- Opened PR #1546 at first-reviewed head `3e34b3de6dc0e00af0c2d50fc44cdf76d24521de` and ran the preliminary completion-specialist pass concurrently with final ReviewGPT round one and CI.
- Accepted ReviewGPT's stale-state finding. Canonical recurring projection now reanchors to a newer source revision, and reactivation uses the latest consumed-success/failure/activation anchor rather than letting an old successful run override a new activation.
- Accepted ReviewGPT's response-semantics finding. The hosted result now exposes `nextOccurrenceAt`, a deliverable occurrence, instead of the scheduler's internal `nextRunAt`, which can represent a retry or finite-window archival wake. Pending, retrying, delivering, or running state is explicitly unverified; a verified null means there is no later deliverable occurrence.
- Bounded hosted read-after-write proof to the exact persisted automation path plus the canonical runtime-state store. It does not scan local cron jobs, unrelated automations, or scheduled logs, and any post-write projection failure preserves the successful write while returning `timingVerified: false`.
- Added fake-clock scheduler and hosted regressions for reactivation, exact source revisions, retries, finite cutoffs, missing vault-timezone provenance, and equality between hosted confirmation and scheduler projection. Added an opt-in actual-model journey for a foreign 9 PM wall clock and the unverified-success recovery language; its local execution is blocked only by the absent opt-in provider key.
- Accepted ReviewGPT's generated-surface finding. Regenerated the canonical automation JSON schema and CLI skill hash, and added CLI acceptance/rejection coverage for valid and invalid timezone values.
- Ratcheted the hosted runner bundle budget to the measured current bundle: 1,661,348-byte entry, 8,015,234-byte static payload, and 9,990,365-byte total, with bounded tolerances. Bundle assembly, CLI package shape, generated-schema checks, focused runtime suites, and package/workspace typechecks pass.
- Updated the complete initial provider-input measurement from the immutable first-reviewed capture by deterministically replacing only the reviewed timing-confirmation fragment in the same serialized requests. The remediation adds 59 `o200k_harmony` tokens and 294 UTF-8 bytes to both initial runtimes: direct is now 23,875 tokens / 110,321 bytes versus base 23,701 / 109,497 (+174, +0.7341%, +824 bytes); group is 20,347 / 94,770 versus base 20,173 / 93,946 (+174, +0.8625%, +824 bytes). Prompt content is now 14,736 tokens / 72,233 bytes direct and 11,308 / 56,813 group. The current deferred automation tool serialization is 4,470 tokens / 15,097 bytes when loaded.

Now:
- Run final local verification and parent diff review, then commit and push the ReviewGPT remediation head.

Next:
- Update PR #1546's intent/evidence contract, run sensitive full-snapshot ReviewGPT round two against the exact pushed head concurrently with CI, and resolve any remaining accepted finding until the latest substantive round passes.

Open questions (UNCONFIRMED if needed):
- None. The timing result now reuses the canonical scheduler owners through an exact-file projection instead of the broad public job lookup.

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
