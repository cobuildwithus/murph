# Cold, Sauna, and Red-Light Research Restart

Status: active
Created: 2026-04-27
Updated: 2026-04-28

## Goal

Restart the full Health Commons protocol-research workflow for four already-landed protocol pages, using fresh charter-first research workspaces while preserving the existing authored content as the patch target for final page production.

Protocols:

- Cold plunge: `protocol_variant:cold-water-immersion/cold-plunge`
- Bryan Johnson Sauna: `protocol_variant:dry-sauna/bryan-johnson-blueprint`
- Finnish Dry Sauna: `protocol_variant:dry-sauna/murph-finnish-standard-3x-week`
- Red light glasses before bed: `protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed`

Success means each workflow reaches a validated final reducer package that can land conservative, source-bound patches on top of the current Health Commons pages rather than deleting or replacing them wholesale.

## Scope

In scope:

- New research workspaces under `output-packages/research/**`
- This execution plan
- The shared coordination-ledger row for this research restart
- Later final reducer patches to existing Health Commons family/protocol/source/evidence/artifact pages only after evidence and safety QA validate them

Out of scope for startup:

- Deleting the current protocol pages or existing source/evidence corpus
- Landing generated `packages/health-commons/generated/**` outputs
- Merging adjacent modalities unless the new workflow explicitly proves that a separate variant should be updated

## Boundaries

- Cold plunge stays within deliberate tub/plunge cold-water immersion, separate from winter swimming, cold showers, cryotherapy, contrast therapy, breathwork stacks, and post-exercise-only recovery.
- Bryan Johnson Sauna stays a source-attributed external dry-sauna routine, separate from the simpler Finnish dry-sauna experiment and separate from broader Blueprint lifestyle bundles.
- Finnish Dry Sauna stays the Murph-owned dry-sauna experiment, separate from infrared sauna, steam rooms, hot-water immersion, and branded external protocols.
- Red light glasses before bed stays an evening light-reduction / circadian-filtering glasses protocol, separate from whole-body photobiomodulation, skin PBM, bright-light therapy, screen curfew, room-light redesign, melatonin, and CBT-I.

## Tasks

1. Register this research restart in the coordination ledger. Done.
2. Initialize four fresh research workspaces. Done.
3. Tighten each `01-charter` prompt with patch-on-top instructions and current-page references. Done.
4. Send each `01-charter` through named managed browser lanes. Done.
5. Harvest charters and validate boundaries before materialization. Done.
6. Materialize discovery seams after each coherent charter. Done.
7. Send and harvest discovery fanout. Done.
8. Continue snowball, source-ledger, extraction, synthesis, page-builder, evidence QA, safety QA, and final reducer phases when prior artifacts validate. Running for Bryan Johnson Sauna section synthesis, Finnish dry sauna source-ledger next step, and guarded cold plunge / red-light glasses / Bryan 26 retries.

## Current State

Existing Health Commons content for all four protocols is present. Older research workspaces exist for cold plunge and red-light glasses, and the new workflow should treat those as context only, not as the current source of truth.

Fresh restart workspaces:

- Cold plunge: `output-packages/research/cold-plunge-research-restart-20260427`
- Bryan Johnson Sauna: `output-packages/research/bryan-johnson-sauna-research-restart-20260427`
- Finnish Dry Sauna: `output-packages/research/finnish-dry-sauna-research-restart-20260427`
- Red light glasses before bed: `output-packages/research/red-light-glasses-before-bed-research-restart-20260427`

Current thread state:

- Cold plunge: `01-charter` is harvested and succeeded on `eragon`; discovery prompts are materialized. Discovery sends are recorded for `02` through `11`, and all discovery shards `02` through `11` have harvested successfully. `10-snowball-gap-fill` is materialized. A clean Vonneumann retry is sent and actively harvesting with URL validation.
- Bryan Johnson Sauna: `01-charter` is harvested and succeeded on `phlebas`; all 10 discovery shards, `12-snowball-gap-fill`, `11-source-ledger-reducer`, and all 11 extraction batches (`001` through `010`, including split batch `008-01`/`008-02`) have harvested successfully. The reducer produced 294 canonical source records and the extracted corpus is in section synthesis. Section synthesis prompts and wrappers are materialized for seams `20` through `29`. Clean section harvests have succeeded for `20`, `21`, `22`, `23`, `24`, `25`, `27`, `28`, and `29`. Seam `26-section-synthesis-outcomes-measurement` remains pending; recent Eragon, Phlebas, Hercules, Mountain, and Vonneumann retries either collided with unrelated active workflows or failed to record a usable URL and were quarantined.
- Finnish Dry Sauna: `01-charter` is harvested and succeeded on `mountain`; discovery prompts are materialized. Discovery sends are recorded for `02` through `11`, and all discovery shards `02` through `11` have harvested successfully. `10-snowball-gap-fill` is harvested successfully on a clean Mountain conversation after the contaminated Phlebas send state was quarantined. `11-source-ledger-reducer` prompt and command wrappers are materialized, cleanly sent on Phlebas, and actively harvesting.
- Red light glasses before bed: the first send used the wrong provisional protocol namespace and was moved aside under `state/abandoned/`. The corrected charter has harvested successfully and materialized. Discovery `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, and `10` have harvested successfully. Shard `07` succeeded on `phlebas` after a shallow no-artifact `mountain` answer. `10-snowball-gap-fill` is cleanly sent on Vonneumann and actively harvesting.

Active restart queues:

- `restart_cold_snowball_harvest_only_vonneumann_20260428`: actively harvests cold plunge `10-snowball-gap-fill` on its clean Vonneumann URL.
- `red_snowball_vonneumann_harvest_recorded`: actively harvests red-light glasses `10-snowball-gap-fill` on its clean Vonneumann URL.
- `finn_ledger_harvest_phlebas_recorded_20260428`: actively harvests Finnish dry sauna `11-source-ledger-reducer` on its clean Phlebas URL.

Recent queues that should not be treated as active:

- `restart_snowball_retry_clean_lanes` exited after starting only the Finnish clean retry; Finnish later harvested successfully through the replacement Mountain watcher.
- `bryan_hc22_26_direct_recovery5` harvested Bryan `22` successfully but did not leave a valid active Bryan `26` run.
- `bryan_page_builder_after_sections` and `bryan_qa_final_after_page_builder` are not listed as active. If restarted, do not use Eragon for Pro sends until that profile exposes the required Pro model again.
- Bryan `26-section-synthesis-outcomes-measurement` still needs a clean send. Recent attempts were abandoned because they produced no URL, reused the known Eragon `69ef65ba...` conversation, or resolved to active Finnish/prolonged-fasting URLs.

Important browser notes:

- User-reported conversation `69ec305e-09a0-839d-965e-92ed12427e86` belongs to an older `digital-sunset` seam, not this restart, so it is intentionally ignored for this workflow.
- Live `phlebas` conversation `69ef4fd8-4c0c-8398-b231-f01268a42f57` belongs to the separate pre-sleep silent meditation row and is not part of this restart.
- Bryan Johnson Sauna `22-section-synthesis-dose-implementation` conversation `69ef0665-c5c4-839e-b629-1a377c5cee22` was accidentally reused by the new prolonged-fasting charter send on `hercules`. The local watcher for that seam was stopped to prevent harvesting mixed-thread output. A later clean `22` resend exists on Hercules and is the only active `22` harvest target.
- Contaminated retry states from 2026-04-28 for cold plunge snowball, red-light glasses snowball, Bryan `26`, and Finnish `11-source-ledger-reducer` were moved under each workspace's `state/abandoned/` folder after their saved URLs matched unrelated active workflows or failed to produce a valid URL.

## Verification

Planned startup checks:

- Direct readback of each new `workflow.json` and `prompts/01-charter.md`
- Direct readback of each `state/chat-urls/01-charter.txt` or seam state after send
- `git diff --check -- agent-docs/exec-plans/active/2026-04-27-cold-sauna-red-light-research-restart.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Privacy scan over tracked plan/ledger changes and the new charter prompts before handoff

Results so far:

- Four `pnpm research:init` commands passed with explicit `--out-dir` values listed above.
- The four generated `01-charter` prompts were tightened with restart, patch-on-top, source-key preservation, and protocol-boundary instructions.
- Four corrected `pnpm research:run --seam 01-charter --action send` commands passed and recorded thread URLs. Red-light glasses needed one failed/abandoned correction after readback caught the wrong provisional protocol namespace.
- Detached harvest watchers were started for all four workflows.
- Direct readback confirmed all four workflow protocol keys and protocol paths match the intended existing Health Commons pages.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-27-cold-sauna-red-light-research-restart.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Privacy scan over the tracked plan/ledger changes and new charter prompts found no local identifier matches.
- Charter status readback found cold plunge, Bryan Johnson Sauna, Finnish Dry Sauna, and the corrected red-light glasses charter harvested successfully and materialized.
- Discovery sends are now fully recorded for cold plunge `02` through `11`, Bryan Johnson Sauna `02` through `11`, Finnish Dry Sauna `02` through `11`, and red-light glasses `02` through `10`. No restart discovery send process remains active.
- Previous harvest-only lane queues for discovery shards have either completed or been stopped after the discovery phase finished.
- Current downloaded restart artifacts include all four corrected charters, all cold plunge discovery shards `02` through `11`, all Bryan Johnson Sauna discovery shards plus `12-snowball-gap-fill`, all Finnish Dry Sauna discovery shards `02` through `11` plus `10-snowball-gap-fill`, and all red-light discovery shards `02` through `10`.
- Bryan Johnson Sauna extraction batches `001` through `010` all harvested successfully. Section synthesis seams `20`, `21`, `22`, `23`, `24`, `25`, `27`, `28`, and `29` have harvested successfully; `26-section-synthesis-outcomes-measurement` remains the only missing section synthesis seam. Next phases are page builder, evidence QA, safety QA, and final reducer after all section synthesis seams validate.
- Bryan Johnson Sauna downstream prompt and command wrappers are materialized for `30-page-builder`, `31-evidence-qa`, `32-safety-qa`, and `34-final-landing-reducer`; the page-builder controller will not send until all section synthesis seams validate.
- Finnish dry sauna `10-snowball-gap-fill` harvested successfully on Mountain. The Finnish source-ledger reducer prompt and wrappers are materialized and the reducer harvest is active on Phlebas.
