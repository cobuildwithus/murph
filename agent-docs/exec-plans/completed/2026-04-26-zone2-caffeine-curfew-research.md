# Zone 2 and caffeine-curfew Health Commons research

Status: active
Created: 2026-04-26
Updated: 2026-04-27

## Goal

- Run two separate Health Commons research workflows:
  - Zone 2 aerobic base block: 3x/week, 35-60 minutes easy conversational cardio for 4 weeks.
  - Caffeine curfew / caffeine dose reset: no caffeine after roughly 10-11am, or no caffeine within 8 hours of bedtime, for 14 days.
- Success means each workflow preserves a clean evidence boundary, reaches a landing-ready final reducer package, and only lands live Health Commons content if the evidence and safety QA support a runnable Murph experiment.

## Success criteria

- `output-packages/research/zone-2-aerobic-base-block` exists and treats this as sustainable low-intensity aerobic volume, not a Peter Attia-branded doctrine, HIIT, threshold training, clinical cardiac rehab, or elite endurance programming.
- `output-packages/research/caffeine-curfew-dose-reset` exists and treats this as a caffeine-timing and dose-reset protocol aimed at sleep/recovery measurability, not caffeine withdrawal treatment, total caffeine abstinence, stimulant-use treatment, or generic sleep hygiene.
- Each `01-charter` prompt explicitly preserves adjacent exclusions, measurement strategy, safety boundaries, confounders, and variant questions.
- Each charter is sent through a named managed browser lane, harvested, and reviewed before materializing post-charter seams.
- Later phases continue through discovery, snowball/gap-fill, source-ledger reduction, extraction, section synthesis, page builder, evidence QA, safety QA, and final landing reducer when the prior phase is valid.
- Live Health Commons family/protocol/source/artifact files are applied only from a validated final reducer package with conservative claims and explicit safety language.

## Scope

- In scope:
  - `output-packages/research/zone-2-aerobic-base-block/**`
  - `output-packages/research/caffeine-curfew-dose-reset/**`
  - this execution plan
  - the shared coordination-ledger row for this research lane
  - final reducer Health Commons content outputs only after QA clears them
- Out of scope:
  - Combining the two interventions into one workflow.
  - Collapsing Zone 2 with HIIT, Norwegian 4x4, Tabata, threshold/tempo training, cardiac rehabilitation, or performance-coaching identities.
  - Collapsing caffeine curfew with broad sleep hygiene, melatonin, light protocols, total caffeine cessation, stimulant-use disorder care, or withdrawal treatment.
  - Landing generated `packages/health-commons/generated/**` outputs.

## Constraints

- Preserve unrelated dirty work and active research harvests in the shared checkout.
- Use workspace-specific research config and named managed browser lanes.
- Keep claims conservative and source-bound.
- Keep the protocol framing lightweight: bounded experiment, low identity, clear off-ramp, and no compliance or purity language.
- Keep safety language visible:
  - Zone 2: cardiovascular symptoms, injury risk, heat illness, medication-relevant heart-rate interpretation, overtraining, pregnancy, and clinical clearance boundaries.
  - Caffeine curfew: pregnancy, anxiety/panic, arrhythmias, hypertension, insomnia disorder, shift work, medication interactions, withdrawal symptoms, and baseline caffeine dose.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: Zone 2 research drifts into influencer-branded optimization or high-performance endurance training.
   Mitigation: Treat the direct protocol as easy, conversational, sustainable aerobic volume and keep elite, threshold, HIIT, and branded claims adjacent unless evidence supports a separate variant.
2. Risk: Caffeine curfew research overpromises wearable score improvements from short sleep experiments.
   Mitigation: Separate Oura/WHOOP-style readiness, HRV, RHR, sleep duration, sleep latency, and subjective sleep outcomes from stronger clinical sleep claims.
3. Risk: Caffeine studies vary by dose, genotype, habitual use, chronotype, timing, and withdrawal.
   Mitigation: Require the charter and source extraction to track dose, timing relative to bedtime, habitual intake, washout, withdrawal, chronotype, shift work, and confounders.
4. Risk: Browser lanes are busy with other long-running research seams.
   Mitigation: Send charters on lower-load named lanes and avoid starting duplicate wakes when a thread is still active.

## Tasks

1. Initialize the two research workspaces. Done.
2. Add charter scoping guardrails. Done.
3. Send each `01-charter` on named managed lanes. Done.
4. Record thread URLs and seam state. Done.
5. Harvest charters when ready and review boundaries before materialization. Done.
6. Materialize post-charter seams when charters are coherent. Done.
7. Send discovery shards. Done.
8. Harvest discovery shards. Done.
9. Run snowball/gap-fill and build combined candidate corpora. Done.
10. Run source-ledger reducers. Done.
11. Launch source extraction batches. Done, except caffeine batch 002 remains blocked as a recorded lost-target/stale-profile mismatch.
12. Continue downstream research phases through final reducer when prior artifacts validate. In progress.

## Current state

- Workspace: `output-packages/research/zone-2-aerobic-base-block`
- Workspace: `output-packages/research/caffeine-curfew-dose-reset`
- Planned initial lanes:
  - Zone 2 charter: `hercules`
  - caffeine-curfew charter: `vonneumann`
- Charter thread URLs:
  - Zone 2: `https://chatgpt.com/c/69edf6a1-a380-839f-9788-30b9401a1e26`
  - caffeine curfew: `https://chatgpt.com/c/69edf6c9-c870-83a1-809e-072a2dec082a`
- Workspaces initialized.
- Charter prompts now include operator guardrails for adjacent exclusions, measurement strategy, confounders, safety boundaries, and low-identity framing.
- Charters harvested and materialized.
- Discovery harvests are complete for all 20 shards:
  - Zone 2: 10/10 shards harvested with 40 records each.
  - caffeine curfew: 10/10 shards harvested, with 437 total discovery records.
- Snowball/gap-fill is harvested for both workflows.
- Combined reducer input corpora were written:
  - Zone 2: `downloads/combined-source-candidates/source_candidates_combined_v1.json` with 440 records.
  - caffeine curfew: `downloads/combined-source-candidates/source_candidates_combined_v1.json` with 451 records.
- Source-ledger reducers are harvested and validated:
  - Zone 2: 361 canonical source records, 15 extraction batches, max batch size 32.
  - caffeine curfew: 303 canonical source records, 12 extraction batches, max batch size 35.
- Source extraction batch monitors were stopped after the user asked to stop firing off new sends, then resumed after the user asked to continue. Current guardrail: let active harvests finish, but do not allow unattended queue fanout into the next unsent batch.
- Extraction queue state:
  - caffeine curfew: batch 001 completed.
  - caffeine curfew: batch 002 is blocked as a lost-target/stale-profile mismatch. Conversation `69ee23d1-f8ac-8398-9624-302d0b0e9ff3` was sent and originally harvested on `eragon` (`http://127.0.0.1:9448`), but live CDP target readback across checked profiles no longer showed the saved conversation URL after repeated stale `stop-visible` snapshots and thread-content timeouts. The exact `caffeine_curfew_13_source_extraction_batch_002_queue` watcher/process chain was stopped. Do not keep polling the missing `eragon` tab; retry only after verifying the conversation URL is visibly loaded in the intended profile.
  - caffeine curfew: batch 003 completed.
  - caffeine curfew: batch 004 completed on `eragon` with status `succeeded` and an artifact package containing source pages, findings, appraisals, candidates, JSONL, and ZIP output.
  - caffeine curfew: batches 005, 006, 007, 008, and 009 completed with status `succeeded` and source pages, findings, appraisals, candidates, JSONL, and ZIP output. Batch 010 initially failed to send on `eragon` because the composer was not ready; it was rerouted to `hercules`.
  - caffeine curfew: batch 010 completed on `hercules` with status `succeeded`; ZIP integrity passed and the package includes 18 source-page/JSONL rows, 37 findings, 18 evidence appraisals, identity-resolution output, a report, and artifact candidates.
  - caffeine curfew: batch 011 completed on `hercules` with status `succeeded`; ZIP integrity passed and the package includes 31 source-page/JSONL rows, 35 findings, 31 evidence appraisals, report output, and artifact candidates.
  - caffeine curfew: batch 012 completed on `hercules` with status `succeeded`; ZIP integrity passed and the package includes 33 source-page/JSONL rows, 34 findings, 33 evidence appraisals, 33 artifact candidates, report output, and Health Commons source/appraisal files.
  - Zone 2: batch 001 completed.
  - Zone 2: batch 002 completed on `mountain` with status `succeeded` and an artifact package containing source pages, findings, appraisals, candidates, JSONL, and ZIP output.
  - Zone 2: batch 003 completed on `mountain` with status `succeeded`; ZIP integrity passed and the package includes 29 source-page drafts/JSONL rows, 29 findings, 29 evidence appraisals, 29 artifact candidates, and a resolution report showing 29 processed sources.
  - Zone 2: batches 004, 005, 006, 007, and 008 completed on `mountain` with status `succeeded` and source pages, findings, appraisals, candidates, JSONL, and ZIP output. Batch 008 ZIP integrity passed, with 15 JSONL rows, 30 findings, 15 evidence appraisals, 15 artifact candidates, and source-page drafts.
  - Zone 2: batch 009 completed on `mountain` with status `succeeded` after recorded-lane reharvest recovered from the earlier CDP timeout; ZIP integrity passed and the package includes 32 JSONL/source-page rows, 32 findings, 32 evidence appraisals, artifact candidates, and a source-index resolution report.
  - Zone 2: batch 010 completed on `mountain` with status `succeeded`; ZIP integrity passed and the package includes 28 source-page/JSONL rows, 28 findings, 28 evidence appraisals, 28 artifact candidates, and a source-index resolution report.
  - Zone 2: batch 011 completed on `mountain` with status `succeeded`; the package includes 32 source page drafts, 32 reusable source-owned findings, 32 evidence appraisals, and artifact candidates.
  - Resume queue guards stopped `caffeine_extraction_resume_eragon` and `zone2_extraction_resume_mountain` after the current harvests completed, before later unsent extraction batches could be sent.
  - Remaining extraction queue state:
    - Zone 2 batch 012 completed on `phlebas` with status `succeeded`; ZIP integrity passed and the package includes 29 source-page/JSONL rows, 29 findings, 29 evidence appraisals, artifact candidates, and a source-index resolution report.
    - Zone 2 batch 013 completed on `eragon` with status `succeeded`; ZIP integrity passed and the package includes 22 source-page/JSONL rows, 29 findings, 22 evidence appraisals, 22 artifact candidates, and a source-index resolution report.
    - Zone 2 batch 014 completed on `hercules` with status `succeeded`; ZIP integrity passed and the package includes 17 source-page/JSONL rows, 17 findings, 17 evidence appraisals, 17 artifact candidates, and a source-index resolution report.
    - Zone 2 batch 015 completed on `hercules` with status `succeeded`; ZIP integrity passed and the package includes 23 source-page/JSONL rows, 23 findings, 23 evidence appraisals, 23 artifact candidates, and a source-index resolution report.
    - 2026-04-27 reharvest check: batch 015 briefly stalled on a short assistant snapshot, then recovered to a real progress note after same-tab reload polling. After a sustained unchanged snapshot on the 23-record progress note, the stale local watcher was stopped and a fresh recorded-lane `hercules` harvest was started. The fresh harvest completed successfully against the original URL.
    - Caffeine batch 012 completed on `hercules` with status `succeeded`; all planned caffeine extraction batches except blocked batch 002 are now harvested.
    - The old caffeine parent queue wrapper, one-batch waiters, and direct-send parent were stopped so batch 012 cannot auto-advance.
    - 2026-04-27 tail update: Zone 2 batch 011 remains actively busy with `stop-visible`; latest assistant status says it verified the batch stays within the 40-source cap and located prior candidate ledgers for all records. No Zone 2 batch 011 downloadable artifacts are present yet.
    - 2026-04-27 tail update: all managed lanes were occupied by active wake pairs during the latest tail, including the unrelated `hercules` page-builder wake. Caffeine batch 012 therefore remains sent-but-not-harvested; start its harvest only after a lane clears and the saved conversation is visible in the target profile.
    - 2026-04-27 live-target check confirmed the Zone 2 batch 011 URL is visible in the recorded `mountain` profile and the caffeine batch 012 URL is visible in `hercules`. This is not currently a lost-conversation case; continue waiting unless a concrete failure appears. Do not start the caffeine batch 012 harvest while the unrelated `hercules` wake remains active.
    - 2026-04-27 controlled single-seam sends used cleared lanes for Zone 2 batch 012 and batch 013 without restarting the broad queue. Batch 012 was sent/harvested on `phlebas` at `https://chatgpt.com/c/69ef19e0-4dd0-8399-9fd8-dd6b3afc1c94` and has now succeeded. Batch 013 was sent/harvested on `eragon` at `https://chatgpt.com/c/69ef1b54-4e7c-839c-b509-578f808391b3` and remains active with `stop-visible` snapshots and no downloaded artifacts yet. Batch 014 is also active on `hercules` at `https://chatgpt.com/c/69ef26c1-6588-83a0-b1ab-055f2798b924`; batch 015 remains unsent.
    - 2026-04-27 after `hercules` cleared, caffeine batch 012 harvest was started on its recorded `hercules` lane and completed successfully. No caffeine send or harvest process is active.
    - 2026-04-27 latest live-target readback confirmed Zone 2 batch 013 remains visible in `eragon` and batch 014 remains visible in `hercules`. Batch 013 is still on a busy metadata-reuse snapshot; batch 014 has generated extraction files and is doing final validation, but neither has exposed downloaded artifacts yet.
  - Caffeine section synthesis prompts and command wrappers were materialized for seams `20` through `29`; all 10 section response files now exist. Seams `20`, `21`, `22`, `23`, `25`, `26`, `27`, `28`, and `29` harvested through the runner. Seam `24` hit repeated CDP export failures, but the full section answer was visible in the recorded `hercules` page and was recovered into `responses/24-section-synthesis-withdrawal-offramp.md` from that same-profile DOM. Earlier caffeine `30-page-builder` attempts reused wrong browser threads or returned unrelated fasting text; those outputs were abandoned. A fresh direct-wrapper send on `hercules` recorded `https://chatgpt.com/c/69efb89c-eb20-839f-91dd-3d5830b9cc51`, and the harvest is active with a busy `stop-visible` snapshot.
  - Zone 2 section synthesis prompts and command wrappers were materialized for seams `20` through `28`. Seams `20`, `22`, `23`, `24`, `25`, `26`, `27`, and `28` have harvested section response files. The original `21`, `27`, and `28` conversations hit local export failures; `27` and `28` succeeded after fresh reruns. A later `21` rerun received a `time-restricted-eating-18-6` snapshot because concurrent sends shared the `repo.snapshot.zip` attachment alias; that wrong-context output was abandoned. A fresh direct-wrapper `21` send on `hercules` recorded `https://chatgpt.com/c/69efb87c-fff0-83a1-b28c-ecb058c3b7e4`, and the harvest is active with a busy `stop-visible` snapshot.
  - Conversation `69ee134a-58fc-8398-aef9-7a89c1b80779` belongs to the separate red-yeast-rice safety-QA seam on `vonneumann` and is already locally marked `succeeded`; no live watcher for that conversation is active.

## Verification

- Planned:
  - Direct readback of `workflow.json`, `prompts/01-charter.md`, `state/chat-urls/01-charter.txt`, and seam state after send.
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-26-zone2-caffeine-curfew-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - Local identifier privacy scan over tracked plan/ledger changes and new research workspace files.

Results:
- `pnpm research:init "Zone 2 aerobic base block, 3x per week 35-60 minutes easy conversational cardio for 4 weeks" --family aerobic-base-training --slug zone-2-aerobic-base-block --out-dir output-packages/research/zone-2-aerobic-base-block` passed.
- `pnpm research:init "Caffeine curfew / caffeine dose reset, no caffeine after 10-11am or within 8 hours of bedtime for 14 days" --family caffeine-timing --slug caffeine-curfew-dose-reset --out-dir output-packages/research/caffeine-curfew-dose-reset` passed.
- `pnpm research:run --workspace output-packages/research/zone-2-aerobic-base-block --seam 01-charter --action send --lane hercules` passed and recorded the Zone 2 charter URL.
- `pnpm research:run --workspace output-packages/research/caffeine-curfew-dose-reset --seam 01-charter --action send --lane vonneumann` passed and recorded the caffeine-curfew charter URL.
- `pnpm research:run --workspace output-packages/research/caffeine-curfew-dose-reset --seam 01-charter --action harvest` passed.
- `pnpm research:materialize --workspace output-packages/research/caffeine-curfew-dose-reset` passed and generated 10 discovery shards plus later templates.
- `pnpm research:run --workspace output-packages/research/zone-2-aerobic-base-block --seam 01-charter --action harvest` passed.
- `pnpm research:materialize --workspace output-packages/research/zone-2-aerobic-base-block` passed and generated 10 discovery shards plus later templates.
- A staggered discovery-send queue passed for all 20 discovery shards across `hercules`, `vonneumann`, and `eragon`.
- Direct JSON readback passed for all 20 discovery artifacts: each `source_candidates_v1.json` parsed and had non-empty `records`.
- `pnpm research:run --workspace output-packages/research/caffeine-curfew-dose-reset --seam 10-snowball-gap-fill --action harvest` passed.
- `pnpm research:run --workspace output-packages/research/zone-2-aerobic-base-block --seam 10-snowball-gap-fill --action harvest` passed.
- Combined candidate-corpus readback passed:
  - Zone 2: 440 records.
  - caffeine curfew: 451 records.
- Source-ledger reducer artifact readback passed:
  - Zone 2: `canonical_source_ledger_v1.json` parsed with 361 records; `source_extraction_batches_v1.json` parsed with 15 batches.
  - caffeine curfew: `canonical_source_ledger_v1.json` parsed with 303 records; `source_extraction_batches_v1.json` parsed with 12 batches.
- Local queue/process readback on 2026-04-26 confirmed no active `caffeine_curfew_13_source_extraction_batch_002_queue` screen and no matching `13-source-extraction-batch-002` watcher process beyond the current coordination-note command.
- Direct status readback on 2026-04-26 confirmed caffeine batch 001, caffeine batch 003, and Zone 2 batch 001 were harvested successfully.
- Live CDP target readback on 2026-04-26 did not show caffeine batch 002 conversation `69ee23d1-f8ac-8398-9624-302d0b0e9ff3` in any checked managed lane, so it remains blocked rather than re-polled.
- `screen -ls` on 2026-04-26 showed `caffeine_extraction_resume_eragon` and `zone2_extraction_resume_mountain` active after resumed sends.
- Later readback showed those resume queues still had unsent later batches, so `guard_stop_caffeine_pid_after_current` and `guard_stop_zone2_pid_after_current` were launched to stop the queue wrappers after the current harvest completes and before the next send branch.
- Direct artifact/status readback confirmed Zone 2 batch 002 and caffeine batch 004 both ended with `state=succeeded`.
- Guard logs confirmed both queue wrappers were stopped after those current harvests completed.
- `screen -ls` on 2026-04-27 confirmed `zone2_extraction_remaining_mountain` and `caffeine_extraction_remaining_eragon_v2` are active.
- Direct artifact/status readback confirmed caffeine batch 005 and Zone 2 batch 003 ended with `state=succeeded`.
- Zone 2 batch 003 ZIP integrity passed; artifact readback found 29 source-page drafts/JSONL rows, 29 findings, 29 evidence appraisals, 29 artifact candidates, and 29 processed sources in the resolution report.
- Direct artifact/status readback confirmed Zone 2 batches 004-008 and caffeine batches 006-009 ended with `state=succeeded`; ZIP integrity passed for each checked package.
- Zone 2 batch 008 artifact readback found 15 JSONL rows, 30 findings, 15 evidence appraisals, 15 artifact candidates, and source-page drafts.
- Caffeine batch 010 send failed on `eragon` with `Composer was not ready for draft staging`; the batch had no saved URL, so the remaining caffeine queue was restarted on `hercules`.
- Zone 2 batch 009 was already sent when the previous wrapper stopped before harvest; `zone2_extraction_remaining_mountain_v2` restarted from the saved URL rather than sending a duplicate.
- Direct status readback confirmed Zone 2 batch 009 and caffeine batch 010 are in `waiting` / `checked-once` state with no downloaded artifacts yet.
- Direct process/log readback confirmed both active wake children are running; the parent queue wrappers were resumed from `T+` to `S+` after an external `SIGSTOP` pause.
- Caffeine batch 010 ended with `state=succeeded`; artifact readback found 18 JSONL/source-page rows, 37 findings, 18 evidence appraisals, identity-resolution output, report output, and a ZIP package with clean integrity.
- Caffeine batch 011 completed on `hercules`; the parent wrapper and follow-up waiters were stopped, but a later direct send recorded a batch 012 URL before it could be stopped.
- Zone 2 batch 009 recorded-lane harvest exited with code 1 after repeated busy snapshots and CDP thread-content timeouts. Live CDP target readback still showed the saved batch 009 URL visible in the recorded `mountain` profile, so a recorded-lane reharvest is active under `zone2_batch009_mountain_reharvest`.
- Direct readback later confirmed Zone 2 batch 009 completed with `state=succeeded`; artifact readback found 32 JSONL/source-page rows, 32 findings, 32 evidence appraisals, artifact candidates, a source-index resolution report, and a ZIP package with clean integrity.
- A restarted Zone 2 queue recorded batch 010 before stopping. A later v5 wrapper also stopped before a durable harvest completed, and direct process/log readback confirmed `restart_mountain_harvest_queue` is waiting to harvest the saved batch 010 URL once `mountain` has no active wakes.
- Later `restart_mountain_harvest_queue` expansions briefly launched multiple local harvests for the saved Zone 2 batch 010 URL; older duplicate launcher chains were terminated, leaving one active recorded-lane wake.
- Direct process readback on 2026-04-27 later confirmed no caffeine send or waiter process remains active after the batch 012 direct send recorded a URL and was stopped.
- Conversation `69ee134a-58fc-8398-aef9-7a89c1b80779` was traced to red-yeast-rice `32-safety-qa` on `vonneumann`; status readback showed `state=succeeded`, and process readback showed no active watcher for that conversation.
- Direct artifact/status readback confirmed Zone 2 batch 010 and caffeine batch 011 completed with `state=succeeded`; ZIP integrity passed for both. Zone 2 batch 010 readback found 28 JSONL/source-page rows, 28 findings, 28 evidence appraisals, 28 artifact candidates, and a source-index resolution report. Caffeine batch 011 readback found 31 JSONL/source-page rows, 35 findings, 31 evidence appraisals, report output, and artifact candidates.
- Zone 2 batch 011 was sent on `mountain` at conversation `69ef045b-0034-839f-962a-6295f457051c`; caffeine batch 012 was sent on `hercules` at conversation `69ef0821-59cc-8399-ae76-acb4f1195ab9`; both are now harvested and validated.
- 2026-04-27 Zone 2 batch 011 completed and validated: 32 source-page/JSONL rows, 32 findings, 32 evidence appraisals, 32 artifact candidates, 32 processed sources in the source-index resolution report, and clean ZIP integrity.
- 2026-04-27 caffeine batch 012 completed and validated: 33 source-page/JSONL rows, 34 findings, 33 evidence appraisals, 33 artifact candidates, 33 processed sources in the report, and clean ZIP integrity.
- 2026-04-27 controlled Zone 2 batch 012 and batch 013 sends passed and recorded URLs; their recorded-lane harvests remain active with busy `stop-visible` snapshots.
- 2026-04-27 Zone 2 batch 014 send passed on `hercules` and its recorded-lane harvest is active. A later tail found Zone 2 batches 012, 013, and 014 still `waiting` / `checked-once` with busy `stop-visible` snapshots and no downloaded artifacts yet.
- 2026-04-27 Zone 2 batch 012 completed and validated: 29 source-page/JSONL rows, 29 findings, 29 evidence appraisals, artifact candidates, source-index resolution output, and clean ZIP integrity.
- 2026-04-27 latest live-target readback for active Zone 2 batches passed: batch 013 URL visible in `eragon`, batch 014 URL visible in `hercules`; both remained `waiting` / `checked-once` with busy `stop-visible` snapshots and no artifacts.
- 2026-04-27 Zone 2 batches 013 and 014 completed and validated. Batch 013 readback found 22 source-page/JSONL rows, 29 findings, 22 evidence appraisals, 22 artifact candidates, source-index resolution output, and clean ZIP integrity. Batch 014 readback found 17 source-page/JSONL rows, 17 findings, 17 evidence appraisals, 17 artifact candidates, source-index resolution output, and clean ZIP integrity.
- 2026-04-27 Zone 2 batch 015 send passed on `hercules`; its recorded-lane harvest is active, visible in `hercules`, and currently `waiting` / `checked-once` with busy `stop-visible` packaging output and no artifacts yet.
- 2026-04-27 batch 015 reharvest assessment initially passed after the short stalled snapshot recovered to a normal progress note. A later sustained check remained unchanged on the same 23-record snapshot, so the stale local watcher was stopped and a fresh recorded-lane `hercules` harvest was started. Reharvest readback remains `waiting` / `checked-once`, busy `stop-visible`, with the URL visible in `hercules` and no artifacts yet.
- 2026-04-28 Caffeine section synthesis readback found all 10 response files present. The `24-withdrawal-offramp` runner status remains failed because of repeated CDP export errors, but the same-profile DOM recovery produced a structured section file with `SECTION_CLAIMS_V1`, conflicts/caveats, and source coverage gaps. Caffeine `30-page-builder` wrong-thread/wrong-topic outputs were quarantined; a fresh direct-wrapper send recorded `https://chatgpt.com/c/69efb89c-eb20-839f-91dd-3d5830b9cc51` and is actively harvesting on `hercules`.
- 2026-04-28 Zone 2 section synthesis readback found 8/9 response files present after `27-claim-and-appraisal-materialization` and `28-experiment-onboarding` succeeded on rerun. The `21-dose-implementation` wrong-context snapshot was traced to concurrent sends overwriting the shared `repo.snapshot.zip` attachment alias. The active research configs and scaffold generator now use workspace-specific snapshot attachment names. A fresh direct-wrapper `21` send recorded `https://chatgpt.com/c/69efb87c-fff0-83a1-b28c-ecb058c3b7e4` and is actively harvesting on `hercules`.
