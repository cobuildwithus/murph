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
8. Continue snowball, source-ledger, extraction, synthesis, page-builder, evidence QA, safety QA, and final reducer phases when prior artifacts validate. Running source-extraction send and retry fanout for cold plunge and Finnish dry sauna, red-light source-ledger reduction, and a guarded Bryan `26` retry.

## Current State

Existing Health Commons content for all four protocols is present. Older research workspaces exist for cold plunge and red-light glasses, and the new workflow should treat those as context only, not as the current source of truth.

Fresh restart workspaces:

- Cold plunge: `output-packages/research/cold-plunge-research-restart-20260427`
- Bryan Johnson Sauna: `output-packages/research/bryan-johnson-sauna-research-restart-20260427`
- Finnish Dry Sauna: `output-packages/research/finnish-dry-sauna-research-restart-20260427`
- Red light glasses before bed: `output-packages/research/red-light-glasses-before-bed-research-restart-20260427`

Current thread state:

- Cold plunge: `01-charter` is harvested and succeeded on `eragon`; discovery shards `02` through `11`, `10-snowball-gap-fill`, and `11-source-ledger-reducer` have harvested successfully. The reducer produced 262 canonical source records split into 12 extraction batches. Extraction batch `001` has harvested successfully. Extraction batch `003` harvested successfully from the restart retry wave. Extraction batches `002`, `004`, `006`, and `008` have clean recorded sends and are actively harvesting. Extraction batches `007` and `009` have clean recorded sends queued for harvest. Extraction batch `012` was quarantined after its active harvest preview switched to red-light source-ledger content. Extraction batches `005`, `011`, and `012` remain retry targets.
- Bryan Johnson Sauna: `01-charter` is harvested and succeeded on `phlebas`; all 10 discovery shards, `12-snowball-gap-fill`, `11-source-ledger-reducer`, and all 11 extraction batches (`001` through `010`, including split batch `008-01`/`008-02`) have harvested successfully. The reducer produced 294 canonical source records. Section synthesis prompts and wrappers are materialized for seams `20` through `29`. Clean section harvests have succeeded for `20`, `21`, `22`, `23`, `24`, `25`, `27`, `28`, and `29`. `26-section-synthesis-outcomes-measurement` remains missing after shallow/no-URL/owned-URL retries, including a 2026-04-28 Eragon retry that resolved to Finnish extraction `001`.
- Finnish Dry Sauna: `01-charter` is harvested and succeeded on `mountain`; discovery shards `02` through `11`, `10-snowball-gap-fill`, and `11-source-ledger-reducer` have harvested successfully. The reducer produced 265 canonical source records split into 12 extraction batches. Extraction prompts and command wrappers for `12-source-extraction-001` through `012` are materialized. Extraction batch `012` harvested successfully. Extraction batch `001` recovered a recorded Eragon send after the contaminated prior state was moved aside, but is not yet harvesting. Extraction batch `003` was quarantined after its harvest returned dry-sauna batch `005` content. Batches `002`, `003`, `004`, `005`, `006`, `007`, `008`, `009`, `010`, and `011` remain retry targets after the latest aggressive fanout hit ownership guards or wrong-batch contamination.
- Red light glasses before bed: the first send used the wrong provisional protocol namespace and was moved aside under `state/abandoned/`. The corrected charter has harvested successfully and materialized. Discovery `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, and `10` plus `10-snowball-gap-fill` have harvested successfully. `11-source-ledger-reducer` prompt and wrappers are materialized. A clean Vonneumann send is now actively harvesting after earlier retries resolved to unrelated cold or Finnish extraction URLs.

Active restart queues:

- `hc_restart_controller_20260428`: running a polling controller that harvests completed sends and retries missing/failed seams when lanes free up.
- `hc_restart_harvest_cold004_phlebas_20260428`: actively harvests cold extraction batch `004` on its recorded Phlebas lane.
- `hc_restart_harvest_cold006_eragon_20260428`: actively harvests cold extraction batch `006` on its recorded Eragon lane.
- Controller-started harvests remain active for cold extraction batches `002` and `008` plus red-light `11-source-ledger-reducer`.

Recent queues that should not be treated as active:

- `restart_snowball_retry_clean_lanes` exited after starting only the Finnish clean retry; Finnish later harvested successfully through the replacement Mountain watcher.
- `bryan_hc22_26_direct_recovery5` harvested Bryan `22` successfully but did not leave a valid active Bryan `26` run.
- `bryan_page_builder_after_sections` and `bryan_qa_final_after_page_builder` are not listed as active. If restarted, do not use Eragon for Pro sends until that profile exposes the required Pro model again.
- Bryan `26-section-synthesis-outcomes-measurement` still needs a clean usable synthesis. Recent attempts were abandoned because they produced no URL, reused the known Eragon `69ef65ba...` conversation, resolved to active Finnish/prolonged-fasting URLs, or returned only a shallow preamble.

Important browser notes:

- User-reported conversation `69ec305e-09a0-839d-965e-92ed12427e86` belongs to an older `digital-sunset` seam, not this restart, so it is intentionally ignored for this workflow.
- Live `phlebas` conversation `69ef4fd8-4c0c-8398-b231-f01268a42f57` belongs to the separate pre-sleep silent meditation row and is not part of this restart.
- Bryan Johnson Sauna `22-section-synthesis-dose-implementation` conversation `69ef0665-c5c4-839e-b629-1a377c5cee22` was accidentally reused by the new prolonged-fasting charter send on `hercules`. The local watcher for that seam was stopped to prevent harvesting mixed-thread output. A later clean `22` resend exists on Hercules and is the only active `22` harvest target.
- Contaminated retry states from 2026-04-28 for cold plunge snowball, red-light glasses snowball, Bryan `26`, Finnish `11-source-ledger-reducer`, multiple cold/Finnish extraction sends, and stale no-process cold `005` / Finnish `007` sends were moved under each workspace's `state/abandoned/` folder after their saved URLs matched unrelated active workflows, failed to produce a valid URL, or no longer had a matching live process.

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
- Current downloaded restart artifacts include all four corrected charters, all cold plunge discovery shards `02` through `11`, cold plunge `10-snowball-gap-fill`, cold plunge `11-source-ledger-reducer`, cold plunge extraction batch `001`, all Bryan Johnson Sauna discovery shards plus `12-snowball-gap-fill`, all Finnish Dry Sauna discovery shards `02` through `11` plus `10-snowball-gap-fill` and `11-source-ledger-reducer`, and all red-light discovery shards `02` through `10` plus `10-snowball-gap-fill`.
- Bryan Johnson Sauna extraction batches `001` through `010` all harvested successfully. Section synthesis seams `20`, `21`, `22`, `23`, `24`, `25`, `27`, `28`, and `29` have harvested successfully; `26-section-synthesis-outcomes-measurement` remains the only missing usable section synthesis seam after one shallow response was abandoned. Next phases are page builder, evidence QA, safety QA, and final reducer after all section synthesis seams validate.
- Bryan Johnson Sauna downstream prompt and command wrappers are materialized for `30-page-builder`, `31-evidence-qa`, `32-safety-qa`, and `34-final-landing-reducer`; the page-builder controller will not send until all section synthesis seams validate.
- Finnish dry sauna extraction prompts and command wrappers for `12-source-extraction-001` through `012` were materialized from the reducer output. Red-light `11-source-ledger-reducer` prompt and command wrappers were materialized from the template after snowball completion.
- Detached send/retry fanouts have exited. The aggressive restart send fanout recorded clean cold extraction sends for `004`, `006`, `007`, `008`, and `009`, plus a recovered Finnish extraction `001` send. It correctly refused to record owned URLs for the remaining failed seams.
- Detached controller `hc_restart_controller_20260428` is running. Cold extraction `003` harvested successfully, cold extraction `012` and Finnish extraction `003` were quarantined after contamination, and active harvests now cover cold extraction `002`, `004`, `006`, and `008`, plus red-light `11-source-ledger-reducer`.
- Finnish dry sauna `10-snowball-gap-fill`, source-ledger reducer, and extraction batch `012` harvested successfully. Finnish extraction `003` is actively harvesting on its recorded Mountain lane.
