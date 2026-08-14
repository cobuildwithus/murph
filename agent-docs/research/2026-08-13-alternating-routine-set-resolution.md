# Alternating routine set-resolution incident

Date investigated: 2026-08-13

Status: root cause isolated; prompt-owner fix prepared

## Privacy boundary

The affected hosted account was resolved internally. Its identifier and the exact correlation evidence remain only in restricted operational context. This document intentionally omits account and contact identifiers, exact timestamps, message bodies, feedback wording and counts, lookup keys, and event ids. The production database was queried read-only, and no production row content was copied into the repository.

## Symptom and impact

A terse completion for several sets in an established alternating strength routine was recorded under the other exercise. The assistant then reported a cumulative total for the wrong exercise. The write was therefore structurally valid but semantically attached to the wrong canonical plan owner.

This is a trust-impacting health-log correctness defect. It can corrupt both the member's exercise history and any later total derived from those events.

## Production correlation

A privacy-bounded search resolved the affected account and correlated the report with the surrounding direct-conversation execution. The durable boundary evidence shows that:

- every correlated conversation input was consumed;
- provider execution occurred after ingress;
- the correlated direct replies reached final delivery without a recorded delivery failure; and
- the final adjacent inputs intentionally shared one provider turn and one delivery.

These observations rule out dropped ingress, duplicate delivery, and provider-send failure as the boundary that selected the wrong exercise. Exact timestamps, account-level feedback history, and distinctive event sequences are intentionally excluded from Git because they are unnecessary to establish that conclusion and could make the incident correlatable.

## Evidence inspected

- Read-only primary production control database via `murph-prod-psql-ro`:
  - `hosted_product_feedback` for bounded incident attribution and timing;
  - `hosted_mailbox_item` for accepted/consumed conversation work;
  - `hosted_ingress_latency_trace` for provider-start correlation;
  - `hosted_linq_delivery` for direct-thread delivery outcome.
- Repository history for commit `86a8c5a126e8d160a5ee57b0022762987339bdee` (`fix: make repeated workout tallies occurrence-aware`, PR 1455).
- Current assistant behavior owners:
  - `packages/assistant-engine/skills/experiment-onboarding/SKILL.md`;
  - `packages/assistant-engine/skills/behavior-followthrough/SKILL.md`;
  - `packages/assistant-engine/skills/strength-training/SKILL.md`;
  - `packages/assistant-engine/src/assistant/system-prompt.ts`;
  - `packages/assistant-engine/src/assistant-skill-assets.ts`.
- Canonical write behavior in `packages/vault-usecases/src/usecases/experiment-journal-vault.ts` and `intervention-experiment-link.ts`.

The dedicated `murph-prod-runtime-logs-psql-ro` helper is unavailable in this environment, and the primary database correctly has no `hosted_runtime_log` table. Exact model tool-call telemetry is therefore not available for this incident. Encrypted message payloads were not decrypted for the investigation.

## Failing boundary

The failure is at assistant target resolution immediately before the canonical session writes.

The prior occurrence-aware fix correctly established that:

- a repeated target uses one `intervention_session` per confirmed occurrence;
- a fixed per-occurrence quantity belongs on every event;
- historical totals come from linked explicit events rather than elapsed days or the planned rotation.

It did not establish how a terse completion must select the exercise and exact experiment or regimen owner. The adjacent behavior guidance required full canonical records when advising about a current routine, but did not extend that read-before-decide rule to completion writes. The resident skill router and strength skill discovery metadata also did not name repeated-set logging as an owned request.

That left conversational recency, the prior logged exercise, or reminder prose available as an implicit selector. Once the wrong experiment id was selected, the canonical write layer could still accept internally consistent events and progress could correctly total the wrong owner's linked records. The persistence layer therefore behaved as designed; it received the wrong semantic owner from the assistant.

Confidence is high that this is a real specification gap and the smallest failing boundary. Confidence that it reproduces the exact historical tool sequence is medium because content-free runtime tool telemetry is unavailable.

## Minimal fix

The patch keeps existing data owners and adds no schema, queue, fallback state, or dependency. It changes the assistant contract so that a terse repeated-set completion must:

1. Load the full active experiment and every linked regimen required to interpret the routine; automation state is not target-selection evidence.
2. Resolve the current exercise from the trusted member-local date plus the saved anchor/start date and rotation or phase rule.
3. Resolve exactly one exercise, one canonical experiment or regimen owner, and one current per-set standard.
4. Treat recent conversation, the previous set, prior assistant output, and reminder wording as navigation rather than authoritative selection evidence.
5. Ask one narrow clarification and write nothing when canonical evidence is missing, stale, conflicting, or non-unique.
6. Create one occurrence for each explicitly confirmed set, use the resolved exercise's exact owner for every write, attach the current quantity to each event, and re-read that same owner's progress before reporting totals.

The resident skill router and strength-training discovery metadata now explicitly cover repeated-set logging so the owner is discoverable for terse completion turns.

## Regression proof

Deterministic instruction and discovery tests use a synthetic, non-production scenario. They verify:

- skill discovery owns completed-set logging;
- canonical owner and member-local target resolution precede writes;
- conversational recency cannot select the exercise;
- ambiguity fails closed without a write;
- a multi-set completion creates one occurrence per set under the resolved owner;
- ordinary non-strength habit handling is unchanged;
- naming the current exercise authorizes only the current completion, not plan repair;
- reminder automations cannot select or block a uniquely resolved routine target; and
- group reports receive a private-conversation handoff instead of private reads or writes.

`packages/assistant-engine/test/assistant-codex-real-e2e.test.ts` adds a real-model App Server lane backed by a stateful synthetic `vault-cli`. It checks exact owner and quantity writes, same-owner progress and linked-event rereads before the total, a zero-write ambiguity branch, and a zero-private-access group handoff.

The three real-model scenarios passed locally. The direct success scenario also presents a stale reminder for the other exercise, proving that automation prose cannot redirect the uniquely resolved canonical target.

A pinned `gpt-5.6-terra` Codex App Server capture against a local scripted Responses endpoint rendered complete synthetic direct and group initial requests in production code mode. An exact resident-router substitution measured the corrected patch against the prior route in those normalized requests. Using `gpt-tokenizer` 3.4.0 `o200k_harmony`, the direct request moved from 29,660 tokens / 135,107 UTF-8 bytes to 29,696 / 135,305 (+36 tokens, +0.1214%; +198 bytes). The group request moved from 26,559 tokens / 121,605 bytes to 26,595 / 121,803 (+36 tokens, +0.1355%; +198 bytes). The small increase preserves the pre-existing running/cardio and recovery routing contracts while adding an explicit private repeated-set owner and group handoff. The measurement included `include`, `input`, `parallel_tool_calls`, `text`, and `tool_choice`; `tools` and `instructions` were absent from these code-mode request bodies. It excluded model selection, reasoning, storage/streaming, service tier, cache/client metadata, and transport headers identically, and normalized temporary Codex-home and workspace paths. Skill-body guidance is loaded only after routing, so it does not increase the initial request.

## Remaining operational work

- The patch does not alter or repair existing member records. Any production correction should be a separate verified-private reconciliation with the affected member, after reading the exact canonical events and obtaining confirmation for the intended edit.
- A deployed hosted-runtime canary remains useful because the unavailable runtime-log database prevents reconstruction of the historical model tool sequence.
- Deployment requires only the assistant-engine asset update; there is no database migration or Web/Cloudflare ordering dependency.

## Review plan

Exact-head preliminary specialist and final ReviewGPT reviews are required before merge handoff. Their outcomes remain PR audit artifacts rather than incident evidence; this report does not self-attest review completion.
