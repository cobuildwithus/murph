# Step-floor and fasting Health Commons research setup

Status: active
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Start two separate Health Commons research workflows from the user's prompt:
  - daily step-count floor, with 10,000 steps/day as the familiar starter target and lower/higher commitment variants
  - time-restricted eating / intermittent fasting, with an 18-hour no-calorie fasting window as the familiar starter target and lower/higher commitment variants
- Success means both workspaces are initialized, their charter seams are submitted or a concrete send blocker is recorded, and the next phase is clear without landing live Health Commons pages yet.

## Success criteria

- `output-packages/research/daily-step-floor` exists with a charter-first scaffold.
- `output-packages/research/time-restricted-eating-18-6` exists with a charter-first scaffold.
- Each `01-charter` prompt explicitly preserves commitment tiers, adjacent exclusions, measurement strategy, confounders, safety boundaries, and low-identity framing.
- Each workspace has a persisted `01-charter` thread URL after send, or a specific send/login/browser blocker is recorded.
- Direct readback confirms each `workflow.json`, `prompts/01-charter.md`, and send result state is internally consistent.

## Scope

- In scope:
  - Research setup under `output-packages/research/daily-step-floor/**`.
  - Research setup under `output-packages/research/time-restricted-eating-18-6/**`.
  - Charter scoping guardrails for graded commitment tiers, adherence burden, outcomes, confounders, and safety boundaries.
- Out of scope:
  - Editing live Health Commons family/protocol/source pages.
  - Regenerating or committing Health Commons generated catalog files.
  - Collapsing daily step floor with post-meal walking, Zone 2 aerobic training, HIIT, exercise snacks, rehabilitation, weight-loss bundles, or formal exercise programs unless the charter explicitly supports a variant link.
  - Collapsing time-restricted eating with early-dinner meal timing, calorie restriction, ketogenic/low-carb dieting, religious fasting, alternate-day fasting, multi-day fasting, eating-disorder care, diabetes treatment, or weight-loss programs unless the charter explicitly supports a variant link.

## Constraints

- Preserve unrelated dirty work and active research lanes in the shared checkout.
- Use the repo research orchestrator and workspace-specific review-gpt configs.
- Prefer named managed browser lanes with measured launch timing.
- Keep claims evidence-led and conservative, especially for sleep, glucose, insulin sensitivity, weight, appetite, mood, HRV, resting heart rate, cardiovascular outcomes, and all-cause mortality claims.
- Keep the protocol framing lightweight: bounded experiment, graded options, clear off-ramp, and no compliance or purity language.
- Do not expose local identifiers, secrets, raw credentials, or direct personal identifiers in files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: Step-floor research may drift into generic exercise, post-meal walking, or fitness-status comparison.
   Mitigation: Treat the direct protocol as a daily minimum movement target with graded burden, and keep training intensity, meal timing, rehab, and weight-loss programs adjacent unless evidence supports separate variants.
2. Risk: Time-restricted eating research may conflate fasting window, earlier meal timing, total calorie reduction, diet composition, and weight loss.
   Mitigation: Require the charter to separate fasting duration from meal timing, calorie intake, macros, and clinical treatment contexts.
3. Risk: Intermittent fasting can be unsafe or inappropriate for some users.
   Mitigation: Require visible safety boundaries for pregnancy, eating-disorder risk, diabetes medications or hypoglycemia risk, adolescents, underweight users, heavy training, shift work, medical conditions, and medication timing.
4. Risk: Commitment tiers could become prescriptive or shame-oriented.
   Mitigation: Frame tiers as optional burden levels and require an off-ramp when the protocol increases stress, hunger distress, injury risk, sleep disruption, or social cost.

## Tasks

1. Initialize the two research workspaces. Done.
2. Add charter scoping guardrails. Done.
3. Send each `01-charter` on named managed lanes. Done.
4. Record thread URLs and seam state. Done.
5. Harvest and materialize both charters. Done.
6. Send the first 10 discovery shards with 60-second spacing on the most open browser lanes. Done.
7. Send the next 10 discovery shards with 60-second spacing on the most open browser lanes. Done.
8. Harvest existing discovery threads without starting new sends. Done.
9. Materialize and send snowball/gap-fill seams for both workflows. Done.
10. Harvest snowball/gap-fill seams for both workflows. Done.
11. Materialize and send source-ledger reducer seams for both workflows. Done.
12. Harvest and validate source-ledger reducer seams for both workflows. Done.
13. Materialize source-extraction batch prompts and wrappers for both workflows. Done.
14. Send source-extraction batch seams with measured spacing across named browser lanes. Paused after partial fanout.
15. Harvest existing saved extraction threads without starting new sends. Running for the first daily step floor extraction thread.

## Decisions

- Use `daily-step-floor` as the step-count starter protocol slug.
- Use `time-restricted-eating-18-6` as the fasting starter protocol slug.
- Treat these as separate workflows because their mechanisms, safety boundaries, confounders, and measurement plans differ materially.
- Include lower-commitment variants in the charter prompt:
  - Step floor: baseline plus 6k, 8k, 10k, and 12k steps/day variants, with progressive ramps when needed.
  - Time-restricted eating: 12:12, 14:10, 16:8, and 18:6 variants, with 18:6 as the higher-commitment starter question rather than a default for everyone.

## Current state

- Plan registered.
- Both charter-first workspaces are initialized.
- Charter prompts were tightened with graded commitment tiers, adjacent exclusions, measurement strategy, confounders, safety boundaries, and low-identity framing.
- Daily step floor `01-charter` was sent on `mountain` and persisted a thread URL.
- Time-restricted eating `01-charter` was sent on `phlebas` and persisted a thread URL.
- Daily step floor `01-charter` was harvested and materialized; the workspace generated 10 discovery shards.
- Time-restricted eating `01-charter` was harvested and materialized; the workspace generated 10 discovery shards.
- The fasting charter response needed a mechanical response-format normalization from flattened `JSON{...}` labels to fenced `json` blocks before materialization could parse the required machine-readable blocks.
- Daily step floor discovery sends `02` through `11` are complete with 60-second spacing:
  - `phlebas`: `02-discovery-direct-step-floor-trials`, `07-discovery-sedentary-and-activity-pattern`
  - `eragon`: `03-discovery-dose-response-cut-points`, `08-discovery-cardiometabolic-and-fitness-endpoints`
  - `vonneumann`: `04-discovery-baseline-plus-and-ramp`, `09-discovery-mental-health-sleep-quality-of-life`
  - `hercules`: `05-discovery-measurement-validity`, `10-discovery-safety-special-populations`
  - `mountain`: `06-discovery-cadence-intensity-bouts`, `11-discovery-guidelines-and-external-protocol-claims`
- Time-restricted eating discovery sends `02` through `11` are complete with 60-second spacing:
  - `phlebas`: `02-discovery-direct-18-6-six-hour-tre`, `07-discovery-safety-medications-diabetes-hypoglycemia`
  - `mountain`: `03-discovery-graded-window-12-14-16-8`, `08-discovery-behavioral-eating-disorder-mood`
  - `vonneumann`: `04-discovery-early-vs-late-meal-timing`, `09-discovery-sleep-recovery-wearables-training`
  - `hercules`: `05-discovery-calorie-restriction-and-diet-confounding`, `10-discovery-special-populations-contraindications`
  - `eragon`: `06-discovery-metabolic-cardiovascular-endpoints`, `11-discovery-guidelines-external-protocols-and-registries`
- Discovery harvest is complete for all already-sent discovery threads; no new sends were started after the user asked to stop sends.
- Harvested discovery artifacts currently present:
  - Daily step floor: `02` through `11`, all 10 discovery shards, 415 parsed candidate records.
  - Time-restricted eating: `02` through `11`, all 10 discovery shards, 423 parsed candidate records.
- Full discovery harvest readback totals: 20/20 parsed `source_candidates_v1.json` artifacts with 838 candidate records.
- Snowball/gap-fill prompts and command wrappers were materialized for both workflows.
- Daily step floor `10-snowball-gap-fill` was sent on `phlebas` and persisted a thread URL.
- Time-restricted eating `10-snowball-gap-fill` was sent on `mountain` after 60-second spacing and persisted a thread URL.
- Time-restricted eating `10-snowball-gap-fill` was harvested on `mountain`.
- Daily step floor `10-snowball-gap-fill` was harvested on its recorded `phlebas` lane after a cross-lane mountain visibility check failed to keep the saved conversation loaded.
- Both snowball responses are present with Additions, Corrections, Missing-source diagnosis, and Variant split notes sections.
- Source-ledger reducer prompts and command wrappers were materialized for both workflows, with harvested snowball responses included as reducer inputs.
- Daily step floor `11-source-ledger-reducer` was sent on `eragon`, harvested on its recorded lane, and validated with 334 canonical records split into 13 extraction batches; maximum batch size is 36 and no non-excluded records are missing `batchId`.
- Time-restricted eating `11-source-ledger-reducer` was sent on `vonneumann`, harvested on its recorded lane after stale local tab/watcher recovery, and validated with 306 canonical records split into 13 extraction batches; maximum batch size is 35 and no non-excluded records are missing `batchId`.
- Source-extraction prompts and send/harvest command wrappers are materialized for 26 total batches: 13 daily step floor batches and 13 time-restricted eating batches.
- Source-extraction prompts and command wrappers were regenerated with concrete batch ids and no remaining template placeholders.
- The original detached source-extraction send queue recorded the first extraction URL, daily step floor `12-source-extraction-batch-001` on `vonneumann`, then stalled inside an over-broad redaction scan and was stopped.
- The send queue script was narrowed to redact only logs, state, downloads, and manager text/json/log files, then relaunched under `step_tre_extraction_send_queue`; it skipped the existing daily step floor `12-source-extraction-batch-001` URL and recorded time-restricted eating `12-source-extraction-batch-001` on `eragon`.
- The queue was stopped again after daily step floor `12-source-extraction-batch-002` initially failed because later batch command wrappers were missing; the missing source-extraction prompts/wrappers were regenerated for both workflows, the queue was relaunched from URL checkpoints, and daily step floor `12-source-extraction-batch-002` recorded a chat URL on `eragon`.
- A supervised foreground send pass continued the fanout after the detached queue proved unstable. Later unattended restarted queues recorded the remaining extraction URLs before they could be stopped, so current recorded extraction-send state is daily step floor 13/13 and time-restricted eating 13/13.
- New extraction sends are paused, and no step/TRE extraction send process remains active. Treat the newly recorded extraction URLs as existing saved threads only.
- Existing-thread harvests have advanced: daily step floor `001`, `002`, `005`, `006`, and `007` have succeeded; daily step floor `003`, `004`, and `008` through `013` have saved URLs pending harvest. Time-restricted eating `002`, `003`, and `005` have succeeded; `001`, `004`, and `006` through `013` have saved URLs pending harvest.
- Browser-profile mismatch recorded: daily step floor `03-discovery-dose-response-cut-points` conversation `69ee2247-81e0-839b-a33b-2e30fc203f65` was sent on `eragon`, but a mountain `--explore-lane` harvest failed to load thread content. The exact local wake/research-run chain and parent mountain explore-lane queue are stopped. A later recorded-eragon harvest produced a valid parsed artifact for this seam before that eragon queue was stopped. Do not continue any cross-lane harvest queue without per-thread visibility preflight.

## Verification

- Planned:
  - Direct readback of both `workflow.json` files and `prompts/01-charter.md`.
  - Confirm `state/chat-urls/01-charter.txt` exists for each sent charter, or record the send blocker.
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-26-step-floor-fasting-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - Local identifier privacy scan over the active plan, coordination ledger, and edited charter prompts.

Results:
- `pnpm research:init "Daily step-count floor with 10,000 steps per day as a familiar starter target, graded commitment variants such as baseline plus 6k, 8k, 10k, and 12k steps per day, and progressive ramp options" --family daily-step-floor --slug daily-step-floor --out-dir output-packages/research/daily-step-floor` passed.
- `pnpm research:init "Time-restricted eating / intermittent fasting with an 18-hour no-calorie fasting window as a higher-commitment starter target, graded variants such as 12:12, 14:10, 16:8, and 18:6, and safety boundaries for unsupervised wellness experiments" --family time-restricted-eating --slug time-restricted-eating-18-6 --out-dir output-packages/research/time-restricted-eating-18-6` passed.
- `pnpm research:run --workspace output-packages/research/daily-step-floor --seam 01-charter --action send --lane mountain` passed.
- `pnpm research:run --workspace output-packages/research/time-restricted-eating-18-6 --seam 01-charter --action send --lane phlebas` passed.
- Direct readback confirmed both `state/seams/01-charter.json` files recorded completed sends with persisted `state/chat-urls/01-charter.txt` files.
- `pnpm research:run --workspace output-packages/research/daily-step-floor --seam 01-charter --action harvest` passed.
- `pnpm research:materialize --workspace output-packages/research/daily-step-floor` passed and generated 10 discovery shards.
- `pnpm research:run --workspace output-packages/research/time-restricted-eating-18-6 --seam 01-charter --action harvest` passed.
- First `pnpm research:materialize --workspace output-packages/research/time-restricted-eating-18-6` failed on flattened `JSON{...}` charter blocks.
- After mechanical response-format normalization, `pnpm research:materialize --workspace output-packages/research/time-restricted-eating-18-6` passed and generated 10 discovery shards.
- Daily step-floor discovery send queue passed for all 10 shards with 60-second spacing across `phlebas`, `eragon`, `vonneumann`, `hercules`, and `mountain`.
- Direct state readback passed for all 10 daily step-floor discovery seams: every `state/seams/*discovery*.json` has `send.status: completed`, the expected lane, and a persisted chat URL.
- Direct chat URL readback passed for all 10 daily step-floor discovery shards under `state/chat-urls/`.
- Time-restricted-eating discovery send queue passed for all 10 shards with 60-second spacing across `phlebas`, `mountain`, `vonneumann`, `hercules`, and `eragon`.
- Direct state readback passed for all 10 time-restricted-eating discovery seams: every `state/seams/*discovery*.json` has `send.status: completed`, the expected lane, and a persisted chat URL.
- Direct chat URL readback passed for all 10 time-restricted-eating discovery shards under `state/chat-urls/`.
- Scoped `git diff --check` passed for the active plan, coordination ledger, and both edited charter prompts.
- Local identifier privacy scan passed over the active plan, coordination ledger, and both new research workspaces.
- Discovery harvest artifact readback found 20/20 discovery artifacts present with non-empty parsed candidate records: 10 daily step-floor shards with 415 candidate records and 10 time-restricted-eating shards with 423 candidate records.
- Mountain `--explore-lane` harvest for daily step floor `03-discovery-dose-response-cut-points` failed with a thread-content timeout because the conversation was not visible in that profile; the mountain parent queue was stopped. A subsequent recorded-eragon harvest produced the required artifact before the eragon queue was stopped.
- Post-harvest local identifier privacy scan passed over the active plan, coordination ledger, and both research workspaces after redacting generated local path residue from new harvest status files.
- Post-harvest scoped `git diff --check` passed for the active plan, coordination ledger, and both research workspaces.
- `pnpm test:smoke` passed.
- `bash -n` passed for both new snowball/gap-fill send/harvest command wrappers.
- `pnpm research:run --workspace output-packages/research/daily-step-floor --seam 10-snowball-gap-fill --action send --lane phlebas` passed and recorded a thread URL.
- `pnpm research:run --workspace output-packages/research/time-restricted-eating-18-6 --seam 10-snowball-gap-fill --action send --lane mountain` passed and recorded a thread URL.
- Direct readback confirmed both `10-snowball-gap-fill` seam states have `send.status: completed`, expected lanes, and persisted chat URLs.
- Post-snowball-send local identifier privacy scan passed over the active plan, coordination ledger, and both research workspaces after redacting generated local path residue from new send logs.
- Post-snowball-send scoped `git diff --check` passed for the active plan, coordination ledger, and both research workspaces.
- Post-snowball-send `pnpm test:smoke` passed.
- Post-snowball-send `pnpm typecheck` passed.
- `pnpm research:run --workspace output-packages/research/time-restricted-eating-18-6 --seam 10-snowball-gap-fill --action harvest --lane mountain` passed.
- `pnpm research:run --workspace output-packages/research/daily-step-floor --seam 10-snowball-gap-fill --action harvest --lane phlebas` passed.
- Direct readback confirmed both `10-snowball-gap-fill` seam states have `harvest.status: completed`.
- Response readback confirmed both `responses/10-snowball-gap-fill.md` files exist and include the expected snowball sections.
- Post-snowball-harvest local identifier privacy scan passed over the active plan, coordination ledger, and both research workspaces after redacting generated local path residue from new harvest status files.
- Post-snowball-harvest scoped `git diff --check` passed for the active plan, coordination ledger, and both research workspaces.
- Post-snowball-harvest `pnpm test:smoke` passed.
- Post-snowball-harvest `pnpm typecheck` failed in `apps/web` while running `health-commons:generate` with `Unexpected array indentation`; current dirty tree includes unrelated Health Commons content under static-stretching paths, and no step-floor/time-restricted-eating harvest process remains active.
- `bash -n` passed for both new source-ledger reducer send/harvest command wrappers.
- `pnpm research:run --workspace output-packages/research/daily-step-floor --seam 11-source-ledger-reducer --action send --lane eragon` passed and recorded a thread URL.
- `pnpm research:run --workspace output-packages/research/time-restricted-eating-18-6 --seam 11-source-ledger-reducer --action send --lane vonneumann` passed and recorded a thread URL.
- Direct readback confirmed both `11-source-ledger-reducer` seam states have `send.status: completed`, expected lanes, and persisted chat URLs.
- Post-source-ledger-send local identifier privacy scan passed over the active plan, coordination ledger, and both research workspaces after redacting generated local path residue from new send logs.
- Post-source-ledger-send scoped `git diff --check` passed for the active plan, coordination ledger, and both research workspaces.
- Post-source-ledger-send `pnpm test:smoke` passed.
- Post-source-ledger-send `pnpm typecheck` failed in `apps/web` while running `health-commons:generate`; the current failure is unrelated static-stretching content validation in `packages/health-commons/content/protocols/static-stretching/at-home-static-stretching-for-flexibility.md` (`protocol.keepInMind[2]` expected string, `safety.stopIf[6]` exceeds 240 characters).
- `pnpm research:run --workspace output-packages/research/daily-step-floor --seam 11-source-ledger-reducer --action harvest --lane eragon` passed and downloaded the required reducer artifacts.
- `pnpm research:run --workspace output-packages/research/time-restricted-eating-18-6 --seam 11-source-ledger-reducer --action harvest --lane vonneumann` passed after stale local tab/watcher recovery and downloaded the required reducer artifacts.
- Source-ledger reducer artifact validation passed for daily step floor: `sourceCount=334`, 334 records, 13 batches, maximum batch size 36, no oversized batches, and no non-excluded records missing `batchId`.
- Source-ledger reducer artifact validation passed for time-restricted eating: `sourceCount=306`, 306 records, 13 batches, maximum batch size 35, no oversized batches, and no non-excluded records missing `batchId`.
- Post-source-ledger-harvest local identifier privacy scan passed over the active plan, coordination ledger, and both research workspaces after redacting generated local path residue from new harvest status files.
- Post-source-ledger-harvest scoped `git diff --check` passed for the active plan, coordination ledger, and both research workspaces.
- Post-source-ledger-harvest process check found no matching daily step floor or time-restricted eating `research-run`, `thread wake`, or `pnpm research:run` process.
- Post-source-ledger-harvest `pnpm test:smoke` passed.
- Post-source-ledger-harvest `pnpm typecheck` passed.
- `bash -n` passed for all 26 generated source-extraction send/harvest command wrappers.
- Source-extraction materialization readback found 13 prompts, 13 send wrappers, and 13 harvest wrappers in each workflow.
- `screen -S step_tre_extraction_send_queue -dm bash output-packages/research/_manager/step-tre-extraction-send-queue.sh` launched the measured source-extraction send queue.
- Send-queue readback confirmed daily step floor `12-source-extraction-batch-001` recorded the first extraction chat URL.
- The first send queue was stopped before any additional extraction sends were recorded because its broad redaction scan stalled.
- `bash -n output-packages/research/_manager/step-tre-extraction-send-queue.sh` passed after narrowing the queue redaction scope.
- Relaunched `step_tre_extraction_send_queue`; send-queue readback confirmed time-restricted eating `12-source-extraction-batch-001` recorded an extraction chat URL.
- A harvest-only watcher was started for daily step floor `12-source-extraction-batch-001` on `vonneumann`; current local status is `waiting` with partial wake/download output present.
- The send queue was stopped again after daily step floor `12-source-extraction-batch-002` failed against missing later batch wrappers; all 26 extraction prompts/wrappers were regenerated and `bash -n` passed for the regenerated wrappers.
- Relaunched `step_tre_extraction_send_queue` again; send-queue readback confirmed daily step floor `12-source-extraction-batch-002` recorded an extraction chat URL.
- Direct send recovered time-restricted eating `12-source-extraction-batch-003` on `mountain` after the detached queue exited without recording it.
- Supervised foreground fanout recorded daily step floor `12-source-extraction-batch-004`, recovered time-restricted eating `12-source-extraction-batch-004` on a later retry, and recorded daily step floor `12-source-extraction-batch-005`, time-restricted eating `12-source-extraction-batch-005`, and daily step floor `12-source-extraction-batch-006`.
- Time-restricted eating `12-source-extraction-batch-006` failed to record a URL on `vonneumann` and then failed again on `eragon`; send fanout is paused at daily step floor 6/13 and time-restricted eating 5/13.
- Post-partial-extraction-send privacy scan passed over the active plan, coordination ledger, both research workspaces, and the step/TRE manager logs/scripts.
- Post-partial-extraction-send scoped `git diff --check` passed for the active plan, coordination ledger, both research workspaces, and the step/TRE manager logs/scripts.
- Post-partial-extraction-send `pnpm test:smoke` passed.
- Post-partial-extraction-send `pnpm typecheck` failed in unrelated `apps/cloudflare` hosted-runtime tests that still reference the old hosted run/job contract shape (`HostedAssistantRuntimeJob*`, `finalGatewayProjectionSnapshot`, missing `kind: "workspace-run"`, and related workspace-run request fields). The current step/TRE research workspace changes do not touch those files.
- Current send-process readback found no live step/TRE extraction send process. Existing saved extraction URLs are being handled only through harvest queues/watchers.
