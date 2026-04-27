# Cold, Sauna, and Red-Light Research Restart

Status: active
Created: 2026-04-27
Updated: 2026-04-27

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
7. Send and harvest discovery fanout. Running.
8. Continue discovery, snowball, source-ledger, extraction, synthesis, page-builder, evidence QA, safety QA, and final reducer phases when prior artifacts validate. Running for Bryan Johnson Sauna extraction; pending for the other three until discovery is fully harvested.

## Current State

Existing Health Commons content for all four protocols is present. Older research workspaces exist for cold plunge and red-light glasses, and the new workflow should treat those as context only, not as the current source of truth.

Fresh restart workspaces:

- Cold plunge: `output-packages/research/cold-plunge-research-restart-20260427`
- Bryan Johnson Sauna: `output-packages/research/bryan-johnson-sauna-research-restart-20260427`
- Finnish Dry Sauna: `output-packages/research/finnish-dry-sauna-research-restart-20260427`
- Red light glasses before bed: `output-packages/research/red-light-glasses-before-bed-research-restart-20260427`

Current thread state:

- Cold plunge: `01-charter` is harvested and succeeded on `eragon`; discovery prompts are materialized. Discovery sends are recorded for `02` through `11`. Discovery `02` through `10` have harvested successfully; `11` has a saved `mountain` URL pending harvest.
- Bryan Johnson Sauna: `01-charter` is harvested and succeeded on `phlebas`; all 10 discovery shards, `12-snowball-gap-fill`, and `11-source-ledger-reducer` have harvested successfully. The reducer produced 294 canonical source records and 11 extraction batches. Concrete extraction prompts/commands exist for all batches. `12-source-extraction-batch-001`, `12-source-extraction-batch-002`, `12-source-extraction-batch-003`, and `12-source-extraction-batch-004` harvested successfully on `vonneumann`. Batches `005` through `010` have been sent on `vonneumann` and have saved URLs. Batches `005` through `007` are queued behind the active `vonneumann` lane wake, batches `008-01`/`008-02` are queued behind `005` through `007`, and batches `009`/`010` are queued behind `008-01`/`008-02`.
- Finnish Dry Sauna: `01-charter` is harvested and succeeded on `mountain`; discovery prompts are materialized. Discovery sends are recorded for `02` through `11`; `02`, `03`, `04`, `05`, `06`, `07`, `09`, and `10` have harvested successfully, while saved `08` and `11` are pending harvest.
- Red light glasses before bed: the first send used the wrong provisional protocol namespace and was moved aside under `state/abandoned/`. The corrected charter has harvested successfully and materialized. Discovery `02`, `03`, `04`, `05`, `06`, `07`, `08`, and `10` have harvested successfully. Shard `07` succeeded on `phlebas` after a shallow no-artifact `mountain` answer; shard `09` is waiting with the exact saved URL visible in `mountain`.

Active restart queues:

- `restart_mountain_ordered_current4`: waits for active `mountain` wakes to clear, then harvests red-light `09`, cold plunge `11`, Finnish dry sauna `08`, and Finnish dry sauna `11` in that order on their recorded lane.
- `bryan_harvest_batches_005_007_after_002_004`: waits for active `vonneumann` wakes to clear, then harvests Bryan Johnson Sauna extraction batches `005` through `007`.
- `bryan_harvest_batches_008_after_005_007`: waits for the `005` through `007` queue to finish, then harvests Bryan Johnson Sauna extraction batches `008-01` and `008-02`.
- `bryan_harvest_batches_009_010_after_008`: waits for the `008-01`/`008-02` queue to finish, then harvests Bryan Johnson Sauna extraction batches `009` and `010`.

Important browser notes:

- User-reported conversation `69ec305e-09a0-839d-965e-92ed12427e86` belongs to an older `digital-sunset` seam, not this restart, so it is intentionally ignored for this workflow.
- Live `phlebas` conversation `69ef4fd8-4c0c-8398-b231-f01268a42f57` belongs to the separate pre-sleep silent meditation row and is not part of this restart.

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
- Harvest-only lane queues are active for eragon, vonneumann, mountain, and phlebas saved restart threads. They wait for recorded-lane wake counts to clear before harvesting and do not send new prompts.
- Current downloaded restart artifacts include all four corrected charters, all Bryan Johnson Sauna discovery shards plus `12-snowball-gap-fill`, cold plunge `02` through `08` plus `10`, Finnish Dry Sauna `02` through `07` plus `10`, and red-light discovery `02`, `04`, `06`, `08`, and `10`.
- Bryan Johnson Sauna `11-source-ledger-reducer` is sent on `hercules` and queued for harvest. Do not start extraction until `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json` validate under `downloads/11-source-ledger-reducer/`.
