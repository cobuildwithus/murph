# Social media fast Health Commons research

Status: completed
Created: 2026-05-06
Updated: 2026-05-07

## Goal

- Start a Health Commons research workflow for a bounded social media fast protocol.
- Success means a dedicated local research workspace exists, the charter prompt scopes 24-hour, 72-hour, and 7-day variants clearly, the first charter seam is harvested, and the post-charter discovery seams are materialized and harvested far enough to support candidate reduction.

## Success criteria

- `output-packages/research/social-media-fast` exists with a charter-first workflow scaffold.
- The charter prompt treats 24-hour, 72-hour, and 7-day social media abstinence as candidate variants and asks whether they should stay under one protocol or split.
- The charter keeps this separate from Digital Sunset, generic screen-time reduction, full smartphone abstinence, app-blocker tooling, notification-only changes, dopamine-detox framing, productivity challenges, and clinician-led/problematic-use treatment unless evidence gives a concrete reason to merge.
- Safety, burden, substitution, work/care exceptions, withdrawal-like discomfort, anxiety, loneliness, and life-fit are first-class research dimensions.
- No Health Commons family, protocol, source, artifact, or generated catalog files are edited until the research package is evidence-ready.

## Scope

- In scope:
  - `output-packages/research/social-media-fast/**`
  - this execution plan
  - the shared coordination-ledger row for this research lane
- Out of scope:
  - Landing live Health Commons content pages.
  - Editing the already-landed Digital Sunset protocol.
  - Creating product UI or runtime experiment-onboarding behavior.

## Constraints

- Preserve unrelated dirty work and active research harvests in the shared checkout.
- Keep generated research files path-relative and do not hardcode local absolute paths.
- Keep claims conservative and source-bound.
- Do not moralize social media, discipline, dopamine, productivity, or self-control.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: The protocol collapses direct social media abstinence evidence with broader digital detox or screen-time reduction.
   Mitigation: Require directness labels and keep broader device or screen interventions adjacent unless separable.
2. Risk: Evidence may be mostly student, adolescent, workplace, or problematic-use treatment evidence.
   Mitigation: Require population-mismatch labels before using any source for Murph self-experiment claims.
3. Risk: The intervention is framed as productivity or moral self-control instead of a low-burden experiment.
   Mitigation: Require burden, social cost, communication needs, and off-ramps in the charter and later synthesis.

## Tasks

1. Register the task in the coordination ledger. Done.
2. Scaffold the `social-media-fast` research workspace. Done.
3. Tailor the charter prompt for 24-hour, 72-hour, and 7-day variants. Done.
4. Verify workspace setup and prompt hygiene. Done.
5. Send `01-charter` on a managed research lane. Done on Chrome.
6. Harvest `01-charter` and materialize post-charter seams if coherent. Done.
7. Send discovery shards `02` through `11`. Done.
8. Harvest discovery shards and reduce candidates into extraction batches. Done from 9 valid discovery shards; shard `10` is blocked after repeated invalid/unloadable thread attempts.
9. Run snowball/gap-fill before final source-ledger closure. Done: early snowball attempts failed, then `52-snowball-gap-fill-retry-zero-or-one` on the saved Phlebas lane returned valid `SOURCE_CANDIDATES_V1`.
10. Extract any valid snowball additions. Done: `53-source-extraction-snowball-kolas-72h` extracted the recovered 72-hour SNS abstinence thesis-chapter source.
11. Recover downstream workflow state from valid extraction batches while preserving invalid retry history. Done: local recovery materialized the source ledger, 10 section syntheses, pagebuilder draft, evidence QA, safety QA, and final reducer through step 34 without applying live Health Commons content.
12. Run staged content review before live Health Commons application. Done: source-key consistency, evidence JSONL source-key resolution, safety/hype wording scan, and required duration/safety language checks passed.

## Current state

- Workspace: `output-packages/research/social-media-fast`
- Provisional family: `social-media-abstinence`
- Provisional starter protocol: `social-media-fast`
- Charter seam: `01-charter`
- Charter status: harvested. A ChatGPT thread URL is recorded in `output-packages/research/social-media-fast/state/chat-urls/01-charter.txt`, the thread export is recorded in `state/thread-exports/01-charter.thread.json`, and the promoted response is recorded in `responses/01-charter.md`.
- Send blocker: the first attempt failed because the package helper did not print a recognized `ZIP:` line; the helper was fixed. The second default-profile attempt launched the managed Chrome profile and then produced no thread URL or new log lines for several minutes, so the local automation process was stopped rather than left running.
- Phlebas retry state: Phlebas is listening on the expected local CDP port, and the workspace config now targets that profile. One retry confirmed the ZIP attachment was staged before the browser target crashed. Fresh ChatGPT URL retries then failed because the exposed target had no ready composer or file input, so review-gpt could not stage the draft. After closing the generated social-media-fast tabs, the wrapper opened a clean Phlebas `chatgpt.com` tab but still failed with no ready composer or file input.
- Hercules retry state: Hercules could be prepared on its expected local CDP port, but the ChatGPT renderer crashed during upload/staging with `RESULT_CODE_KILLED_BAD_MESSAGE`.
- Chrome retry state: the normal Chrome remote profile completed draft staging, confirmed the ZIP attachment, auto-sent the charter prompt, and recorded the thread URL.
- Post-charter materialization: `workflow.json` now embeds the charter manifest, search shards, section seams, source-extraction schema, and initial file plan. Discovery prompts and send/harvest wrappers exist for shards `02` through `11`.
- Discovery send/harvest state: prompt-only sends completed for shards `02` through `11`. Valid harvested responses exist for `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, and `11`.
- Lane state: `02` was sent/harvested on Chrome; `03` and `05` on Vonneumann; `04`, `06`, `07`, `08`, `09`, and `11` on Hercules. Keep harvests on the same browser lane as their sends; do not harvest Vonneumann or Hercules threads from Chrome.
- Blocked seam: `10-discovery-measurement-self-experiment-endpoints` is blocked. The original Hercules thread was unloadable, a Hercules retry returned only a citation-chip fragment, and a compact Vonneumann retry also returned only a citation-chip fragment. Do not use the current shard `10` response for candidate reduction.
- Browser-lane invariant: every send now persists `state/threads/<label>.json` with `chatUrl`, `lane`, and `browserEndpoint`; harvest reads that saved file and refuses conflicting ambient browser endpoints unless explicitly overridden.
- Retry default: failed sends, unloadable pages, renderer crashes, empty outputs, citation-chip fragments, missing machine-readable blocks, and non-parseable JSON are retryable by default. Do not mark a seam blocked until a retry is recorded unless the user explicitly stops the workflow.
- Source extraction state: batches `001`, `002`, and `003` harvested usable `SOURCE_EXTRACTION_BATCH_V1` blocks. Batches `004` and `005` plus first smaller retry shards returned invalid tiny, citation-chip-only, or truncated outputs, so they remain retry/gap-fill targets.
- Snowball state: `21` through `24` failed or returned invalid output, then `52-snowball-gap-fill-retry-zero-or-one` was sent/harvested on the saved Phlebas lane and returned one valid snowball candidate. The wake command timed out during assistant-settling, but the downloaded assistant response contained a valid parseable block and was promoted.
- Extraction-gap recovery state: failed extraction batches `004` and `005` were rerun in smaller shards. Valid reruns now cover all selected source candidates; `scripts/materialize-local-recovery.mjs` materialized 179 extracted source records, 176 selected candidates, and 0 unresolved selected candidates. The malformed retry shards `25`, `26`, and `33` remain recorded but are superseded by valid one-source reruns.
- Pagebuilder state: staged source-ledger, section synthesis, pagebuilder, evidence QA, safety QA, and final reducer outputs exist through `34-final-landing-reducer`. Live Health Commons content remains out of scope by plan scope, not because of unresolved research gaps.
- Content-review state: staged landing references resolve to generated source pages; evidence JSONL source keys resolve; required 24-hour, 72-hour, 7-day, mixed-evidence, sparse-72-hour, stop-condition, work/care, emergency, loneliness, and FoMO language is present; hype/safety wording scan found no actionable issue.
- Next step: decide whether to apply the staged Health Commons content package to live content files in a separate scoped task.

## Verification

- Completed:
  - Direct readback of `workflow.json`, `README.md`, `prompts/01-charter.md`, and command wrappers passed.
  - `workflow.json` parsed successfully.
  - `bash -n` passed for generated charter command wrappers and package helper.
  - `git diff --check -- agent-docs/exec-plans/active/2026-05-06-social-media-fast-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - Local identifier privacy scan over the new research workspace, plan, and ledger row passed.
  - `pnpm exec cobuild-review-gpt --help` passed, confirming the runner binary is installed.
  - `output-packages/research/social-media-fast/commands/01-charter.send.sh` was attempted twice on the default managed profile; no `state/chat-urls/01-charter.txt` was produced.
  - Phlebas retries were attempted with the workspace profile config pointed at Phlebas, including a fresh wrapper retry after closing generated tabs; no `state/chat-urls/01-charter.txt` was produced.
  - Hercules retries reached upload/staging but crashed the ChatGPT renderer with `RESULT_CODE_KILLED_BAD_MESSAGE`; no thread URL was produced.
  - Chrome remote-profile retry completed send and produced `state/chat-urls/01-charter.txt`.
  - Chrome harvest completed and promoted `responses/01-charter.md`.
  - Discovery seams `02` through `11` were generated from `SEARCH_SHARDS_V1`.
  - Prompt-only discovery sends completed for shards `02` through `11`.
  - Valid discovery harvests completed for `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, and `11`.
  - Shard `10` retries were recorded as invalid/blocked and excluded from candidate reduction.
  - Research state JSON parsed successfully after marking the partial discovery harvest.
  - `bash -n` passed for generated research command, config, script, and wake-command shell files.
  - `git diff --check -- agent-docs/exec-plans/active/2026-05-06-social-media-fast-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - Local identifier privacy scan over the research workspace, plan, and ledger row passed after redacting generated review-gpt status/replay paths.
  - Process check found no active `social-media-fast`, shard `10`, or `thread wake` processes beyond the check itself.
  - Source candidate reduction produced 180 canonical candidates from 299 discovery occurrences; 175 were selected for extraction.
  - Source extraction batches `001`, `002`, and `003` harvested usable `SOURCE_EXTRACTION_BATCH_V1` blocks with 40 source records each.
  - Source extraction batches `004` and `005`, plus retry shards `17` through `20`, were validated as invalid responses and left as retry/gap-fill targets.
  - `21-snowball-gap-fill` and `22-snowball-gap-fill-retry-compact` were sent and harvested from saved lane records, but both returned only partial/planning-stub text without `SOURCE_CANDIDATES_V1`.
  - `23-snowball-gap-fill-retry-minimal` was sent and harvested on Hercules from the saved lane record, but returned an incomplete `SOURCE_CANDIDATES_V1` JSON block.
  - `24-snowball-gap-fill-retry-ultracompact` was sent and harvested on Vonneumann from the saved lane record, but returned only `SOURCE`.
  - `52-snowball-gap-fill-retry-zero-or-one` was sent on Phlebas from a saved lane record and produced valid `SOURCE_CANDIDATES_V1` with one 72-hour SNS abstinence thesis-chapter candidate.
  - `53-source-extraction-snowball-kolas-72h` was sent and harvested on Phlebas from the saved lane record and produced a valid one-source `SOURCE_EXTRACTION_BATCH_V1` after a minimal JSON URL repair.
  - Extraction-gap reruns `27`, `28`, `29`, `30`, `31`, `32`, `34`, `35`, and `36` returned valid `SOURCE_EXTRACTION_BATCH_V1` blocks.
  - One-source reruns `37` through `51` returned valid `SOURCE_EXTRACTION_BATCH_V1` blocks and superseded invalid shards `25`, `26`, and `33`.
  - Local recovery materialized `CANONICAL_SOURCE_LEDGER_V1`, `SOURCE_EXTRACTION_BATCHES_V1`, 10 `SECTION_SYNTHESIS_V1` responses, a pagebuilder draft package, evidence QA, safety QA, and `34-final-landing-reducer`.
  - The staged package contains source page drafts from the valid extraction set, including the recovered snowball source, and excludes invalid retry outputs from protocol claims.
  - Latest `bash -n` passed for generated research command, config, and script files.
  - Latest research JSON parse check passed for workflow, extraction batch state, and snowball seam state.
  - Latest local identifier privacy scan over the research workspace, plan, and ledger row passed after redacting generated review-gpt status/replay paths.
  - Latest process check found no active `social-media-fast` or `thread wake` processes.
  - Latest `git diff --check -- agent-docs/exec-plans/active/2026-05-06-social-media-fast-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - Latest content-review checks passed: staged landing source references resolve to generated source pages, evidence-appraisal source keys resolve, required duration/safety language is present, and no actionable hype/safety placeholder strings were found.
  - Latest `pnpm typecheck` was blocked by unrelated syntax errors in `packages/cli/src/incur.generated.ts`; the failure is outside this research workspace change.
Completed: 2026-05-07
