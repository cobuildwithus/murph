# Early meal timing Health Commons research setup

Status: active
Created: 2026-04-26
Updated: 2026-04-28

## Goal

- Start two separate Health Commons research workflows from the user's prompt:
  - early dinner / last substantial meal about 3 to 4 hours before bedtime
  - Bryan Johnson-style very early last meal about 8 to 9 hours before bedtime
- Success means both workspaces are initialized, their charter seams are submitted or a concrete send blocker is recorded, and the next phase is clear without landing live Health Commons pages yet.

## Success criteria

- `output-packages/research/early-dinner-before-bed-3-to-4-hours-before-bedtime-20260426-133944Z` exists with a charter-first scaffold.
- `output-packages/research/bryan-johnson-early-dinner-8-to-9-hours-before-bedtime-20260426-133944Z` exists with a charter-first scaffold.
- Each workspace has a persisted `01-charter` thread URL after send, or a specific send/login/browser blocker is recorded.
- The charters keep ordinary 3 to 4 hour pre-bed meal timing separate from the much earlier Bryan Johnson-style variant.
- Direct readback confirms each `workflow.json`, `prompts/01-charter.md`, and send result state is internally consistent.

## Scope

- In scope:
  - Research setup under `output-packages/research/early-dinner-before-bed-3-to-4-hours-before-bedtime-20260426-133944Z/**`.
  - Research setup under `output-packages/research/bryan-johnson-early-dinner-8-to-9-hours-before-bedtime-20260426-133944Z/**`.
  - Charter scoping guardrails for meal timing, circadian timing, reflux, glucose, sleep, fasting-window, and confounder boundaries.
- Out of scope:
  - Editing live Health Commons family/protocol/source pages.
  - Regenerating or committing Health Commons generated catalog files.
  - Collapsing meal timing with broad calorie restriction, weight-loss dieting, intermittent fasting, time-restricted eating, GERD medical treatment, shift-work meal timing, or celebrity blueprint bundles unless the charter explicitly supports a variant split.

## Constraints

- Preserve unrelated dirty work and active research lanes in the shared checkout.
- Use the repo research orchestrator and workspace-specific review-gpt configs.
- Prefer named managed browser lanes with measured launch timing.
- Keep claims evidence-led and conservative, especially for sleep quality, glucose, reflux, circadian phase, weight, appetite, and cardiovascular outcomes.
- Do not expose local identifiers, secrets, raw credentials, or direct personal identifiers in files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: Ordinary early dinner may be conflated with broad time-restricted eating or weight-loss calorie restriction.
   Mitigation: Require the charter to keep fixed pre-bed last-meal timing separate from fasting-window, calorie restriction, and diet-composition interventions.
2. Risk: Bryan Johnson-style early eating may be overfit to one branded routine and mixed with a larger supplement/exercise/sleep stack.
   Mitigation: Treat Bryan Johnson materials as a named external protocol context and require the research to separate direct evidence for very early eating from the full Blueprint bundle.
3. Risk: Meal timing evidence may be confounded by chronotype, shift work, bedtime regularity, meal size/macros, alcohol, caffeine, GERD, diabetes medication, and total calories.
   Mitigation: Require the charter to specify confounder logging and separate clinical populations or supervised treatment variants.

## Tasks

1. Initialize both research workspaces.
2. Review generated charter prompts for scoping guardrails.
3. Send both `01-charter` seams on lower-load named managed lanes, staggering launches if needed.
4. Confirm persisted thread URLs or record blockers. Done.
5. Start charter harvests if lane load allows; otherwise leave harvest/materialization as the next phase. Done: both charter harvests are running in detached screen sessions.
6. Materialize post-charter discovery and later-stage seams. Done for both workspaces; ordinary early dinner needed formatting-only recovery from flattened `JSON{...}` blocks before materialization.
7. Send discovery shards with measured fanout. Paused at user request after 14 attempts: 12 discovery URLs recorded, 2 attempts failed without URLs, and 5 sends were not attempted.
8. Watch/harvest already-sent discovery shards only. Done for visible saved URLs: 10 discovery artifacts harvested and parsed, 2 saved URLs remain blocked by browser visibility/profile mismatch, and no early-meal harvest queues remain active.

## Decisions

- Use `early-dinner-before-bed` as the ordinary pre-bed meal-timing starter protocol slug.
- Use `bryan-johnson-early-dinner` as the named extreme early last-meal starter protocol slug.
- Treat the two timing windows as separate research workflows rather than variants inside one workspace until charter evidence says otherwise.

## Current state

- Plan registered.
- Both charter-first workspaces are initialized with timestamped research slugs.
- Charter prompts were tightened with explicit meal-timing boundaries before send.
- Ordinary early dinner `01-charter` was sent on `phlebas` and persisted a thread URL.
- Bryan Johnson early dinner `01-charter` was sent on `eragon` and persisted a thread URL.
- Ordinary early dinner `01-charter` harvest is running on `phlebas` in detached screen session `early_dinner_charter_harvest`; first wake status is `waiting` with `stop-visible` and partial text.
- Bryan Johnson early dinner `01-charter` harvest is running on `eragon` in detached screen session `bryan_johnson_early_dinner_charter_harvest`; first wake status is `waiting` with `stop-visible` and partial text.
- Both charter harvests completed successfully as terminal inline responses: ordinary early dinner produced a substantive charter and Bryan Johnson early dinner produced a substantive charter.
- Ordinary early dinner returned flattened `JSON{...}` machine-readable blocks. A formatting-only local recovery converted those five blocks to fenced `json` blocks, after which `research:materialize` succeeded.
- Ordinary early dinner is materialized with 9 discovery send seams.
- Bryan Johnson early dinner is materialized with 10 discovery send seams.
- Discovery-send fanout was stopped at user request; no `early_meal_discovery_send_queue` screen or matching queue process remains.
- The queue started at 2026-04-26T14:53:45Z and stopped after the 2026-04-26T15:10:42Z send record.
- Recorded discovery URLs: ordinary early dinner `02` through `07`; Bryan Johnson early dinner `02`, `03`, `04`, `05`, `07`, and `08`.
- Failed without saved URLs: Bryan Johnson `06-discovery-glucose-cgm-metabolic-endpoints` on `vonneumann` and ordinary early dinner `08-discovery-trial-registries-and-unpublished` on `hercules`.
- Not attempted before stop: ordinary early dinner `09` and `10`; Bryan Johnson early dinner `09`, `10`, and `11`.
- Existing-thread harvest watchers completed for visible saved URLs and did not launch new sends.
- Harvested discovery artifacts:
  - ordinary early dinner: `02`, `03`, `05`, `06`, `07`
  - Bryan Johnson early dinner: `03`, `04`, `05`, `07`, `08`
- Saved URLs still missing artifacts:
  - ordinary early dinner `04-discovery-glucose-and-metabolism`: sent on `mountain`, failed on a cross-lane `hercules` harvest, and the saved URL is not visible on any open browser target.
  - Bryan Johnson `02-discovery-external-protocol-bryan-blueprint`: recorded as sent on `mountain`, later visible on `vonneumann`, but the visible-lane harvest stopped with `stopped-wrong-browser-profile-not-visible-in-requested-lane`.
- No early-meal send or harvest queue is currently active.
- Browser-profile mismatch recorded for ordinary early dinner `05-discovery-gerd-and-reflux-boundary`: it was sent on `eragon` (`http://127.0.0.1:9448`) with ChatGPT conversation `69ee28b8-7adc-839f-812c-9911af2a874e`, but the prior harvest watcher tried `hercules` (`http://127.0.0.1:9446`) and failed with no artifact. The `hercules` early-meal harvest queue was stopped and orphaned wrappers were killed; do not poll that conversation from `hercules`.
- CDP target readback verified the `05-discovery-gerd-and-reflux-boundary` conversation is loaded in `eragon` before retry. A single verified `eragon` retry harvest is running in detached screen session `early_meal_05_gerd_eragon_harvest`.
- Browser-profile mismatch recorded for Bryan Johnson `04-discovery-early-time-restricted-eating`: it was sent on `hercules` (`http://127.0.0.1:9446`) with ChatGPT conversation `69ee286f-f874-839b-96d6-4e1ecfc74cbf`, but the prior harvest watcher tried `vonneumann` (`http://127.0.0.1:9444`). The `vonneumann` early-meal harvest queue was stopped and orphaned wrappers were killed; do not poll that conversation from `vonneumann`.
- CDP target readback verified the Bryan Johnson `04-discovery-early-time-restricted-eating` conversation is loaded in `hercules` and not visible in `vonneumann` before retry. The verified `hercules` retry completed and produced `downloads/04-discovery-early-time-restricted-eating/source_candidates_v1.json`.
- Restart attempt on 2026-04-28 found no pre-existing early-meal worker, then quarantined stale failed state for ordinary `04`/`08` and Bryan Johnson `02`/`06`.
- Fresh ordinary `04-discovery-glucose-and-metabolism` send succeeded on `mountain` at conversation `69f05acb-3dd0-839b-bb8b-a86088985901`.
- Fresh ordinary `09-discovery-safety-special-populations` send on `eragon` at conversation `69f05874-1d78-839d-9059-c886edd63b25` was stopped and quarantined because the live assistant text was for an unrelated walking/post-meal charter, not early-dinner safety.
- Ordinary `04-discovery-glucose-and-metabolism` harvest completed successfully and produced `source_candidates_v1.json`.
- Restart rule correction: do not treat a browser profile as globally occupied merely because another workflow has active tabs. For unrelated new sends, use profiles that are CDP-reachable, responsive, under the approximate 30 ChatGPT tab budget, and not overwriting another seam's saved conversation URL.
- Fresh remaining discovery sends recorded clean URLs:
  - ordinary `08-discovery-trial-registries-and-unpublished` on `vonneumann`, conversation `69f06642-606c-839f-bfd3-518c96cee283`
  - ordinary `09-discovery-safety-special-populations` on `eragon`, conversation `69f06645-8494-839d-9703-db7ed3998a00`
  - ordinary `10-discovery-adjacent-variants-and-disambiguation` on `vonneumann`, conversation `69f066a7-27a0-8399-86f5-b110173303f9`
  - Bryan Johnson `02-discovery-external-protocol-bryan-blueprint` on `mountain`, conversation `69f0663e-0338-8399-8922-70eaeba4d3bf`
  - Bryan Johnson `06-discovery-glucose-cgm-metabolic-endpoints` on `phlebas`, conversation `69f06641-f91c-839f-a02c-b1b3da64c66b`
  - Bryan Johnson `09-discovery-safety-boundaries-clinical-nutrition` on `eragon`, conversation `69f066a5-cc7c-839a-8a9d-c965fec63e16`
  - Bryan Johnson `10-discovery-measurement-and-n-of-1-implementation` on `mountain`, conversation `69f066a7-e37c-839b-93dc-bb7dc822a0b4`
  - Bryan Johnson `11-discovery-sibling-ordinary-early-dinner` on `phlebas`, conversation `69f066a5-c7b8-83a1-849e-010067ae91d3`
- Active early-meal harvest watchers:
  - `early_meal_harvest_ordinary08_vonneumann_20260428T075104Z`
  - `early_meal_harvest_ordinary09_eragon_20260428T075104Z`
  - `early_meal_harvest_ordinary10_vonneumann_20260428T075227Z`
  - `early_meal_harvest_bryan02_mountain_20260428T075104Z`
  - `early_meal_harvest_bryan06_phlebas_20260428T075104Z`
  - `early_meal_harvest_bryan09_eragon_20260428T075227Z`
  - `early_meal_harvest_bryan10_mountain_20260428T075227Z`
  - `early_meal_harvest_bryan11_phlebas_20260428T075227Z`
- Duplicate ordinary `08`/`09` harvest watchers with timestamp `20260428T0753Z` were stopped to preserve one local watcher per seam.
- Discovery harvest is complete for both workspaces:
  - ordinary early dinner: 9/9 discovery artifacts, 449 parsed candidate records
  - Bryan Johnson early dinner: 10/10 discovery artifacts, 412 parsed candidate records
- Snowball/gap-fill:
  - Bryan first send on `hercules` failed with no URL, then was quarantined and resent successfully on `phlebas` at conversation `69f07208-63b4-839f-a99a-5898edaafcac`.
  - Ordinary first send on `mountain` stalled without a visible conversation target, then was stopped/quarantined and resent successfully on `vonneumann` at conversation `69f0725a-f964-83a1-913b-430d1f9e05af`.
- Snowball harvest completed for both workspaces:
  - ordinary response length: 29,442 characters
  - Bryan response length: 28,711 characters
- Source-ledger reducer:
  - Concrete `11-source-ledger-reducer.md` prompts and send/harvest wrappers were materialized from templates for both workspaces.
  - Ordinary source-ledger reducer was sent on `vonneumann` at conversation `69f07bff-01bc-839b-b865-042361ecd656`.
  - Active ordinary source-ledger harvest watcher: `early_meal_ordinary_source_ledger_vonneumann_harvest_20260428T0923Z`.
  - Ordinary source-ledger reducer completed with 304 canonical records and 11 extraction batches.
  - Bryan source-ledger reducer first attempt happened before wrappers existed; the second attempt on `phlebas` was blocked by the send-lane visible-conversation guard.
  - Bryan source-ledger reducer was later sent on `vonneumann` at conversation `69f083cb-7dcc-839c-9d79-d2ce6646fa7d`.
  - Active Bryan source-ledger harvest watcher: `early_meal_bryan_source_ledger_vonneumann_harvest_20260428T095455Z`.
  - Bryan source-ledger reducer completed with 285 canonical records and 14 extraction batches.
- Source extraction:
  - Materialized concrete `12-source-extraction-001..011` prompts and command wrappers for ordinary early dinner.
  - Materialized concrete `12-source-extraction-001..014` prompts and command wrappers for Bryan Johnson early dinner.
  - Ordinary `12-source-extraction-001` sent on `vonneumann` at conversation `69f08be3-2378-839b-9479-5bc1765fcd37`; harvest watcher `early_meal_ordinary_extract001_vonneumann_harvest_20260428T102929Z` is active.
  - Bryan `12-source-extraction-001` sent on `eragon` at conversation `69f08be3-a3b4-8398-8a6f-7b4ff9b6e766`; harvest watcher `early_meal_bryan_extract001_eragon_harvest_20260428T102929Z` is active.
  - Ordinary `12-source-extraction-002` sent on `mountain` at conversation `69f094d3-94a8-839e-8f1e-a1c2e5cfe61a`; harvest watcher `early_meal_ordinary_extract002_mountain_harvest_20260428T110734Z` is active.

## Verification

- Direct readback of both `workflow.json` files and `prompts/01-charter.md`.
- Confirm `state/chat-urls/01-charter.txt` exists for each sent charter, or record the send blocker. Passed for both sent charters.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-26-early-meal-timing-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Scoped `git diff --check` passed for the active plan, coordination ledger, and both edited charter prompts.
- Privacy scan passed for the active plan, coordination ledger, and both edited charter prompts.
- Direct wake-status readback confirmed both charter harvests have status snapshots and no final response files yet.
- Direct wake-status readback later confirmed both charter harvests completed.
- `pnpm research:materialize --workspace output-packages/research/early-dinner-before-bed-3-to-4-hours-before-bedtime-20260426-133944Z` passed after formatting-only JSON-block recovery.
- `pnpm research:materialize --workspace output-packages/research/bryan-johnson-early-dinner-8-to-9-hours-before-bedtime-20260426-133944Z` passed.
- Detached queue readback initially confirmed `early_meal_discovery_send_queue` was active and `state/chat-urls/02-discovery-direct-dinner-to-bed-interval.txt` existed.
- After the stop request, `screen -ls` and process readback confirmed no early-meal send queue remains active.
- `screen -ls` readback initially confirmed the three existing-thread harvest queues were active.
- After the profile-mismatch note, `screen -ls` and process readback confirmed the `early_meal_existing_harvest_hercules` queue is stopped.
- Seam-state readback confirmed `05-discovery-gerd-and-reflux-boundary` is now harvesting on `eragon`.
- After the second profile-mismatch note, process readback confirmed the `early_meal_existing_harvest_vonneumann` queue wrappers are stopped.
- Seam-state readback confirmed Bryan Johnson `04-discovery-early-time-restricted-eating` completed harvest on `hercules`.
- Later `screen -ls` / process readback confirmed no early-meal queues remain active.
- Parsed 10 harvested `source_candidates_v1.json` files successfully, totaling 464 `records`.
- Restart readback on 2026-04-28 confirmed no early-meal processes were active before restart.
- After restart correction, all remaining discovery seams produced valid `source_candidates_v1.json`.
- JSON parse/count validation passed for all discovery artifacts.
- Snowball harvest completed for both workspaces; source-ledger reducer completed for both workspaces; source-extraction batch harvests active for ordinary `001`/`002` and Bryan `001`.
