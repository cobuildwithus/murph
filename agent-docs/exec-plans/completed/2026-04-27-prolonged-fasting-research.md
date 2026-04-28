# Prolonged Fasting Health Commons Research

Status: completed

## Goal

Start and carry through a Health Commons research workflow for prolonged fasting as a separate family from daily time-restricted eating.

Success criteria:

- Research workspace exists for 24-hour, 48-hour, and 72-hour fasting variants.
- Charter separates prolonged fasting from daily TRE, alternate-day fasting, 5:2 diets, religious fasting, fasted training, eating-disorder care, diabetes treatment, clinical obesity programs, and medically supervised fasting.
- Safety boundaries explicitly cover hydration, electrolytes, medications, hypoglycemia, refeeding, contraindications, and user-facing stop rules.
- Later phases proceed only after the charter validates the scope and artifact contracts.

## Scope

In scope:

- `output-packages/research/prolonged-fasting-24-72-hours/**`
- This execution plan
- Later Health Commons content only after evidence QA and safety QA validate the landing package

Out of scope:

- Editing or landing the existing `time-restricted-eating-18-6` protocol as part of this start step
- Collapsing multi-day fasting into daily TRE
- Medical fasting protocols, eating-disorder treatment, diabetes medication management, religious fasting, alternate-day fasting, 5:2 dieting, ketogenic dieting, or clinical weight-loss programs

## Tasks

1. Initialize the research workspace. Done.
2. Send a clean charter thread on a managed browser lane. Done.
3. Harvest the charter only after verifying the saved URL is unique and belongs to this workspace. Done.
4. Materialize discovery seams after charter validation. Done.
5. Send discovery seams with guarded lane selection and contamination checks. Done.
6. Harvest discovery seams on their recorded lane. Done.
7. Continue snowball, source-ledger, extraction, synthesis, page builder, Evidence QA, Safety QA, and final reducer phases. Done.

## Current State

- Workspace initialized at `output-packages/research/prolonged-fasting-24-72-hours`.
- First charter send on `hercules` reused existing conversation `69ef0665-c5c4-839e-b629-1a377c5cee22`, which belonged to Bryan Johnson Sauna `22-section-synthesis-dose-implementation`; that fasting send state was removed from the prolonged-fasting workspace and must not be harvested as a fasting charter.
- The collided Bryan watcher was stopped and the cold/sauna/red-light restart plan was annotated.
- Clean fasting charter resend succeeded on `mountain` with conversation `69ef9f84-1118-83a1-8514-4efe85c17b59`.
- Duplicate URL scan found that conversation only in the prolonged-fasting workspace.
- Charter harvest is queued on recorded lane `mountain` in screen session `prolonged_fasting_charter_mountain`; it is waiting for existing `mountain` wakes to clear before starting.
- Attempted cross-lane recovery check on `eragon` by opening the exact fasting charter URL; live CDP did not show conversation `69ef9f84-1118-83a1-8514-4efe85c17b59`, so do not harvest this charter from `eragon`.
- Charter harvest completed on `mountain` and `pnpm research:materialize --workspace output-packages/research/prolonged-fasting-24-72-hours` generated discovery seams `02` through `11`.
- Discovery send attempts have shown browser-thread collision risk:
  - `02-discovery-direct-24-72-water-vlcd` on `hercules` exposed candidate `69ef994b-eaf0-839b-aa06-3595bb94cc3f`, which exported as Daily Step Floor, not fasting.
  - `02-discovery-direct-24-72-water-vlcd` on `vonneumann` exposed candidate `69ef9cfc-ead8-839f-9a4b-126190cfb428`, a known Daily Step Floor page-builder thread.
  - `02-discovery-direct-24-72-water-vlcd` on `mountain` produced no saved URL and no visible fasting conversation, so its running state was quarantined.
- A guarded discovery send queue is running in screen session `prolonged_fasting_guarded_discovery_sends`; it sends one seam at a time, chooses only lanes with zero active wakes and fewer than 20 ChatGPT tabs, opens a fresh ChatGPT home first, kills no-URL sends after 180 seconds, and quarantines malformed or known contaminated URLs.
- Guarded discovery sends completed cleanly for seams `02` through `11`, all on recorded lane `mountain`.
- Per user instruction, the sequential discovery harvest queue was replaced with parallel harvest workers. Cross-profile checks showed only `mountain` could visibly load the saved fasting discovery URLs, so all active discovery harvest workers are running on recorded lane `mountain`.
- Discovery seam `04-discovery-very-low-calorie-and-fmd-boundary` returned `generation-failed` / "Thinking failed"; that failed thread was quarantined and a fresh `04` resend+harvest worker was started in screen session `pf_04_resend_harvest`.
- Current discovery harvest state: `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, `10`, and `11` have succeeded.
- `02-discovery-direct-24-72-water-vlcd` originally completed on `mountain` but produced a wrong-topic/no-artifact result and was quarantined; a clean `mountain` guarded resend timed out without recording a fresh URL, and a fresh guarded resend+harvest on `eragon` succeeded at conversation `69efc5ac-23c4-839b-b0d4-c7b8f8cda27c`.
- `03-discovery-metabolic-timecourse` exported a contaminated mixed thread containing Daily Step Floor and Bryan sauna prompt bodies, so the stale local watcher was stopped, the old state must not be reused, and a clean guarded resend+harvest on `phlebas` succeeded at fresh conversation `69efc37e-0d9c-839a-94a6-81d90db58ba1`.
- `04-discovery-very-low-calorie-and-fmd-boundary` returned `generation-failed` / "Thinking failed" on the original thread and was quarantined; a clean `mountain` guarded resend timed out without recording a fresh URL, and a fresh guarded resend+harvest on `phlebas` succeeded at conversation `69efc5ae-42dc-839a-8c37-182882ddc74c`.
- `05-discovery-safety-adverse-events` exported a contaminated mixed thread containing Finnish sauna, Daily Step Floor, and Silent Meditation prompt bodies, so the stale `mountain` watcher was stopped and a clean guarded resend+harvest on `vonneumann` succeeded at conversation `69efc5f8-2540-8399-8d14-08b55f9ef04b`.
- All discovery candidate ledgers are present and locally shape-validated, with 400 candidate records total across ten shards.
- `10-snowball-gap-fill` was materialized from the template, harvested on `eragon` at conversation `69efcdbd-7cf8-8398-8c5b-eef3627184f5`, and normalized to 16 additional candidate records.
- `11-source-ledger-reducer` has been materialized and harvested. An `eragon` send timed out without recording a URL and was quarantined; a `phlebas` send recorded conversation `69efdb08-9d0c-83a0-8284-f8bc5fe9759b`, and harvest succeeded with 334 canonical records, 11 extraction batches, and 331 records assigned to extraction.
- Extraction batch prompts and commands were generated for `12-source-extraction-batch-001` through `011`.
- A first broad extraction send fanout exposed profile instability: Hercules reused/malformed the old TRE page-builder URL, Vonneumann failed draft staging, and several same-profile concurrent sends recorded no URL. Those no-URL workers were stopped; extraction is now being restarted in cleaner three-profile waves.
- Extraction batch `001` on `phlebas`, `002` on `eragon`, and `003` on `mountain` recorded fresh URLs and are harvesting.
- Extraction batches `004` on `phlebas`, `005` on `eragon`, and `006` on `mountain` recorded fresh URLs and are harvesting.
- Extraction batches `007` on `phlebas`, `008` on `eragon`, and `009` on `mountain` recorded fresh URLs and are harvesting.
- Extraction batches `010` on `phlebas` and `011` on `eragon` recorded fresh URLs and are harvesting.
- All 11 source-extraction batches were sent and harvested in parallel and have succeeded.
- Batch `007` missed the standalone artifact-candidates download, but `ARTIFACT_CANDIDATES_V1.json` was recovered from its extraction zip.
- Section synthesis prompts and commands were materialized for seams `20` through `27`.
- Section synthesis seams `20`, `21`, and `22` recorded fresh URLs and are harvesting.
- Section synthesis seams `23`, `24`, and `25` recorded fresh URLs and are harvesting.
- Section synthesis seams `26` and `27` recorded fresh URLs and are harvesting.
- All section synthesis seams `20` through `27` were sent, harvested in parallel, and have succeeded.
- `30-page-builder` was materialized, sent on `phlebas`, recorded conversation `69f01243-55bc-839f-8d8c-15f462abe27f`, harvested successfully, and returned the package draft used for landing.
- Evidence QA and Safety QA browser seams were attempted, but multiple managed lanes drifted to unrelated research conversations despite saved URLs. Contaminated or shallow QA downloads were quarantined under the workspace, and the stale local watchers were stopped.
- Because the QA browser state was no longer trustworthy, the package was landed from the completed page-builder artifacts with local repo validation instead of relying on contaminated QA/reducer outputs.
- Landed Health Commons content includes the `prolonged-fasting` family, `prolonged-fasting-24-72-hours` protocol variant, 329 source pages, 105 source-protocol appraisal rows, 285 artifact manifest entries, and four new/updated biomarkers plus fasting context on `body-weight`.

## Verification

Planned:

- Direct readback of `workflow.json`, `prompts/01-charter.md`, and `state/seams/01-charter.json`.
- Duplicate URL scan across `output-packages/research/**/state/seams/*.json` before harvest.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-27-prolonged-fasting-research.md agent-docs/exec-plans/active/2026-04-27-cold-sauna-red-light-research-restart.md`.

Results so far:

- `pnpm research:init --topic ... --family prolonged-fasting --slug prolonged-fasting-24-72-hours --out-dir output-packages/research/prolonged-fasting-24-72-hours` passed.
- First `hercules` send was detected as a duplicate conversation and cleared from the new workspace.
- Clean `mountain` send passed and recorded the unique charter conversation.
- `git diff --check` passed for this plan and the cold/sauna/red-light plan note.
- `screen -ls` shows `prolonged_fasting_charter_mountain` detached and the manager log shows it waiting on active `mountain` wakes.
- `eragon` was rejected as a harvest lane for the charter because live CDP did not show the saved fasting conversation after opening the exact URL.
- `downloads/01-charter/status.json` reports `state: succeeded`.
- Guarded discovery queue log: `output-packages/research/_manager/prolonged-fasting-guarded-discovery-sends.log`.
- Parallel discovery harvest launch log: `output-packages/research/_manager/prolonged-fasting-parallel-harvest-mountain.log`.
- Discovery seam `04` resend log: `output-packages/research/_manager/prolonged-fasting-04-resend-harvest.log`.
- Page-builder artifacts were extracted from `downloads/30-page-builder/downloads/prolonged-fasting-package-draft.zip`.
- Local validation normalized source/page frontmatter, removed duplicate/cross-topic source and artifact references, pruned evidence-appraisal rows to protocol researchLandscape groups, and filtered endpoint keys to existing Health Commons endpoint keys.
- `pnpm --filter @murphai/health-commons typecheck` passed.
- `pnpm --filter @murphai/health-commons generate` passed.
- `pnpm --filter @murphai/health-commons generate:check` passed.
- `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` exited 0 and blocked non-redistributable uploads as expected.
- `git diff --check -- packages/health-commons/content agent-docs/exec-plans/active/2026-04-27-prolonged-fasting-research.md` passed before plan archival.
- Scoped privacy grep over the content/plan diff found no local home-directory paths or local account names.

Known unrelated verification note:

- `pnpm --filter @murphai/health-commons test` currently fails one deterministic runtime catalog ordering assertion because the dirty tree contains an uncommitted `alcohol-abstinence` protocol that sorts into the first six protocol variants ahead of the older dry-sauna fixture. The failing assertion is outside the prolonged-fasting diff.
Updated: 2026-04-28
Completed: 2026-04-28
