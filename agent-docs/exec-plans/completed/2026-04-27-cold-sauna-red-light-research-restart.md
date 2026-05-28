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
8. Continue snowball, source-ledger, extraction, synthesis, page-builder, evidence QA, safety QA, and final reducer phases when prior artifacts validate. Current user focus is Finnish Dry Sauna plus red-light glasses before bed; extraction retries need clean ownership of the shared browser lanes.

## Current State

Existing Health Commons content for all four protocols is present. Older research workspaces exist for cold plunge and red-light glasses, and the new workflow should treat those as context only, not as the current source of truth.

Fresh restart workspaces:

- Cold plunge: `output-packages/research/cold-plunge-research-restart-20260427`
- Bryan Johnson Sauna: `output-packages/research/bryan-johnson-sauna-research-restart-20260427`
- Finnish Dry Sauna: `output-packages/research/finnish-dry-sauna-research-restart-20260427`
- Red light glasses before bed: `output-packages/research/red-light-glasses-before-bed-research-restart-20260427`

Current thread state:

- Cold plunge: `01-charter` is harvested and succeeded on `eragon`; discovery shards `02` through `11`, `10-snowball-gap-fill`, and `11-source-ledger-reducer` have harvested successfully. The reducer produced 262 canonical source records split into 12 extraction batches. Artifact readback confirms extraction batches `001`, `002`, `004`, `005`, `006`, `007`, `008`, `009`, and `012` have usable extraction artifacts. Batches `003`, `010`, and `011` produced shallow, wrong-thread, or no-artifact terminal responses and were quarantined under `state/abandoned/` on 2026-04-28. Fresh retries for all remaining cold extraction gaps are now live: `003` is re-harvesting on Hercules, `010` on Phlebas, and `011` on Mountain.
- Bryan Johnson Sauna: `01-charter` is harvested and succeeded on `phlebas`; all 10 discovery shards, `12-snowball-gap-fill`, `11-source-ledger-reducer`, and all 11 extraction batches (`001` through `010`, including split batch `008-01`/`008-02`) have harvested successfully. The reducer produced 294 canonical source records. Section synthesis prompts and wrappers are materialized for seams `20` through `29`, and all section harvests now have usable Bryan-specific responses, including `26-section-synthesis-outcomes-measurement` from Mountain. Two `30-page-builder` Phlebas runs returned shallow no-artifact text and were quarantined. The current `30-page-builder` retry is harvesting on Phlebas.
- Finnish Dry Sauna: `01-charter` is harvested and succeeded on `mountain`; discovery shards `02` through `11`, `10-snowball-gap-fill`, and `11-source-ledger-reducer` have harvested successfully. The reducer produced 265 canonical source records split into 12 extraction batches. Extraction prompts and command wrappers for `12-source-extraction-001` through `012` are materialized. Extraction batches `001` and `012` harvested successfully. Extraction batch `007` has a recorded Phlebas URL from the retry wave and still needs validation before harvest because earlier Phlebas URLs were collision-prone. Extraction batch `003` was quarantined after its harvest returned dry-sauna batch `005` content. Batches `002`, `003`, `004`, `005`, `006`, `008`, `009`, `010`, and `011` remain retry targets after the latest aggressive fanout hit ownership guards or staging failures.
- Red light glasses before bed: the first send used the wrong provisional protocol namespace and was moved aside under `state/abandoned/`. The corrected charter has harvested successfully and materialized. Discovery `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, and `10` plus `10-snowball-gap-fill` have harvested successfully. `11-source-ledger-reducer` harvested successfully and produced 214 canonical source records split into 9 extraction batches. Extraction prompts and command wrappers for batches `001` through `009` are materialized. Extraction batches `001`, `002`, and `003` harvested successfully with expected extraction artifacts. Batches `006` and `007` had URL-less, stuck, duplicate, and then cross-owned URL attempts quarantined for retry; the latest wrong-thread `007` partial was moved under `downloads/abandoned/` at `2026-04-28T11:08Z`. Batches `004`, `005`, `006`, `007`, `008`, and `009` need later clean-lane retries.

Active restart queues:

- `hc_finnish_red_clean_*_20260428b` recorded fresh Finnish extraction URLs for batches `001` through `004`, then a separate local Codex cleanup command killed the screen wrappers and target workspace PIDs at `2026-04-28T14:08Z`. The hidden manager children were stopped. Treat every harvest from that wave as interrupted until artifact readback proves otherwise.
- `output-packages/research/_manager/finnish-red-clean-workers-20260428.sh` is the current clean-lane worker script. It assigns all Finnish extraction batches `001` through `012` and red-light extraction batches `004` through `009` across Eragon, Hercules, Mountain, Phlebas, and Vonneumann. Relaunch only after confirming no cross-topic manager shells remain.

Recent queues that should not be treated as active:

- `restart_snowball_retry_clean_lanes` exited after starting only the Finnish clean retry; Finnish later harvested successfully through the replacement Mountain watcher.
- `cold003_hercules_direct_harvest_20260428T1405Z`, `cold010_phlebas_harvest_20260428T1405Z`, `cold011_mountain_harvest_20260428T1405Z`, and `bryan30_vonneumann_direct_harvest_20260428T1405Z` were stopped after the user narrowed current scope to Finnish/red-light and cross-topic queues were found reusing Finnish conversations.
- `bryan_hc22_26_direct_recovery5` harvested Bryan `22` successfully but did not leave a valid active Bryan `26` run.
- `hc_restart_harvest_cold007_mountain_20260428` harvested cold extraction batch `007` on its recorded Mountain lane.
- `hc_restart_harvest_cold012_hercules_20260428` harvested cold extraction batch `012` successfully with expected extraction artifacts.
- The first cold `12-source-extraction-011` harvest on Vonneumann was quarantined after it returned Bryan Blueprint discovery artifacts rather than cold source-extraction artifacts.
- The fresh cold `12-source-extraction-011` Vonneumann retry was also quarantined after it returned only a shallow preamble and no extraction artifacts.
- The later cold `12-source-extraction-003`, `010`, and `011` no-artifact states were quarantined after direct artifact inventory showed missing required extraction outputs despite wrapper success states.
- Cold `12-source-extraction-010` and `011` retries from the first relaxed multi-tab fanout were quarantined after their harvested assistant previews clearly belonged to Finnish sauna and pre-sleep safety work rather than cold-water immersion extraction.
- A duplicate Bryan `30-page-builder` retry watcher was stopped, and both shallow page-builder attempts were quarantined before the current Phlebas retry.
- Blocked `hc_finnish_red_*` retry-loop screens were stopped after they repeatedly hit send-lane guards or tried to harvest current cold/Bryan conversations into the Finnish workspace.
- `hc_restart_harvest_bryan26_eragon_20260428` resolved to a contaminated URL and its seam state was quarantined.
- `bryan_page_builder_after_sections` and `bryan_qa_final_after_page_builder` are not listed as active. If restarted, do not use Eragon for Pro sends until that profile exposes the required Pro model again.
- Older Bryan `26-section-synthesis-outcomes-measurement` attempts were abandoned because they produced no URL, reused the known Eragon `69ef65ba...` conversation, resolved to active Finnish/prolonged-fasting URLs, or returned only a shallow preamble.
- `bryan26_mountain_send_harvest_retry2_20260428T0906Z` completed successfully with a Bryan-specific terminal section response and is no longer active.
- `red_007_hercules_harvest_retry_20260428T0857Z` was stopped and quarantined after it was found polling the cold plunge `005` conversation rather than a red-light extraction thread.
- `cold005_hercules_send_harvest_retry2_20260428T0904Z` harvested cold extraction batch `005` successfully with expected extraction artifacts.

Important browser notes:

- User-reported conversation `69ec305e-09a0-839d-965e-92ed12427e86` belongs to an older `digital-sunset` seam, not this restart, so it is intentionally ignored for this workflow.
- Live `phlebas` conversation `69ef4fd8-4c0c-8398-b231-f01268a42f57` belongs to the separate pre-sleep silent meditation row and is not part of this restart.
- Current `eragon`, `mountain`, and reopened `vonneumann` visible research tabs belong to separate early-meal or prolonged-fasting workflows; do not reuse those lanes for this restart until the owning conversations finish or the exact restart conversation is visibly loaded in the intended profile.
- Three stale untracked Phlebas review tabs were exported under `output-packages/research/_manager/orphan-phlebas-tabs-20260428T1112Z/` and closed so Phlebas could cleanly own Bryan `30-page-builder`.
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
- Bryan Johnson Sauna extraction batches `001` through `010` all harvested successfully. Section synthesis seams `20` through `29` now have usable responses, including `26-section-synthesis-outcomes-measurement`.
- Bryan Johnson Sauna downstream prompt and command wrappers are materialized for `30-page-builder`, `31-evidence-qa`, `32-safety-qa`, and `34-final-landing-reducer`; `30-page-builder` was sent on Phlebas and is actively harvesting.
- Finnish dry sauna extraction prompts and command wrappers for `12-source-extraction-001` through `012` were materialized from the reducer output. Red-light `11-source-ledger-reducer` prompt and command wrappers were materialized from the template after snowball completion.
- Detached send/retry fanouts have exited. The aggressive restart send fanout recorded clean cold extraction sends for `004`, `006`, `007`, `008`, and `009`, plus a recovered Finnish extraction `001` send. It correctly refused to record owned URLs for the remaining failed seams.
- Cold extraction `010`, `007`, `012`, and `005` harvested successfully after the latest retry wave. Cold extraction `011` is actively harvesting on a clean Hercules retry after two quarantined Vonneumann attempts.
- Red-light source-ledger reducer harvested successfully and concrete extraction batch seams `001` through `009` were generated from the reducer output. Red-light `001`, `002`, and `003` harvested successfully; `006` and `007` were quarantined after stale/no-process or wrong-thread states; and `004`, `005`, `006`, `007`, `008`, and `009` remain clean retry targets.
- Earlier Bryan `26-section-synthesis-outcomes-measurement` retries failed on owned or contaminated URLs, but the later Mountain retry harvested a Bryan-specific terminal section response and unblocked page builder.
- Finnish dry sauna `10-snowball-gap-fill`, source-ledger reducer, and extraction batches `001` and `012` harvested successfully. Finnish `007` has a recorded Phlebas retry URL but still needs validation before harvest.
