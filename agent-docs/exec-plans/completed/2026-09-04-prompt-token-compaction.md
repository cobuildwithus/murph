# Compact shared assistant instructions without weakening action contracts

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Outcome and protected invariants

Reduce resident instruction tokens for Terra and Sol while preserving exact automation timing, consent, current-conversation authority, verified results, bounded browser recovery, and one-reminder appointment follow-through. This is a Patch to existing instruction owners.

## Evidence and ownership

The prior source audit and advisory ReviewGPT response identified duplicated automation mechanics, browser policy, capability-offer prose, and conflicting appointment/refill recipes. The review capture failed model confirmation, so its recommendations are advisory rather than a passed review gate. The implementation base is 61efce27c28bfed62073f677430af29947421b82.

The system-prompt builder owns resident triggers and concise operational reminders; the existing automation tool description/schema owns detailed call contracts; computer-use owns browser execution policy. Keep appointment reminder defaults resident so reporting a booking does not require reading a large browser skill. Remove the skill's conflicting timing defaults and refer to that resident owner. No new abstraction, model-specific prompt, capability router, state, dependency, or runtime operation is needed.

## Scope and design

- Compact hosted automation instructions while retaining common examples, local-time/DST recovery, optimistic concurrency, route restrictions, and result interpretation.
- Compact browser and capability-offer prose without adding required skill reads to unrelated turns.
- Keep local-runner instructions local. Align finite-supply check-ins with localAt and host-generated automation identity.
- Keep private hosted-group skill restructuring and moving static per-turn text out of scope.
- Persisted state and effect ownership do not change. Existing contract fingerprints rotate incompatible threads. Rollback restores text; no schema or deployment ordering requirement is introduced.

## Journeys and proof

- Private member: exact local reminder save, authoritative readback, no duplicate write/inspect, no unnecessary offer or timing question.
- Private appointment: known booking creates one reminder; date/time missing asks for the missing detail; skill and prompt cannot disagree on timing.
- Browser action: safe progress, bounded retry, precise approval/handoff, verified outcome. Retain the detailed skill contract.
- Group route: current-room automation authority remains; unverified email cannot mutate; personal appointment defaults remain excluded.
- Run deterministic composed-prompt and real tool-contract tests, relevant typecheck, and complexity review. Broad release and coverage verification belongs to a future PR delivery lane.
- Add a focused production-derived live journey and run it on Terra and Sol; inspect exact effects and actual reply quality. Record Ready/Hold honestly.
- Measure identical base/head direct and group fixtures, distinguishing authored layers from complete provider input. Do not label a tokenizer proxy or partial request as exact billing evidence.

## Progress and evidence

- Implemented the shared wording reduction, removed duplicate automation fragments and the hosted local-runner footer, kept appointment defaults with the resident owner, and corrected the refill recipe to the hosted local-time and generated-identity contract.
- Focused deterministic proof: the nine-file suite initially passed 172 tests and exposed one stale browser-wording assertion. After correcting that assertion, the affected two-file rerun passed all 84 tests. The unchanged passing files cover appointment defaults and skill consistency, capability offers, hosted domain tools, skill assets, and dynamic context. No assertion was weakened to permit a bad action.
- Final `pnpm --dir packages/assistant-engine typecheck`: passed after restoring the temporary capture probe. `git diff --check` and the task diff privacy scan passed.
- Real subscription proof: `pnpm test:assistant:live -- --test "preserves appointment timing and single-write readback with compact shared instructions"`, then the same command with `--model gpt-5.6-sol`: both passed. Each uses production prompt layers and the real automation tool adapter, asserts exactly one save with local-time arguments, checks the resolved 08:00 local reminder for an 11:00 appointment, and forbids duplicate inspection/write. Both actual synthetic replies were reviewed: Ready for this journey. This is one focused sample per model, not a full behavioral equivalence claim.
- Complete synthetic first-request capture: Codex 0.151.0 app-server against a local scripted provider, using the bundled Terra catalog forced to hosted code mode. The same direct and group fixtures were captured against the implementation base and edited prompt owners. UUIDs, temporary fixture suffixes, and volatile timing were normalized before measurement.
- `o200k_base` proxy counts including JSON framing: private request 32,262 -> 31,415 tokens (-847, -2.63%); group request 25,602 -> 24,756 (-846, -3.30%). Authored prompt: private 18,971 -> 18,120 and group 14,971 -> 14,120 (-851 each). The real requests expose substantial generated Codex/tool guidance beyond the authored prompt.
- Measurement limits: synthetic fixtures omit member history, private hosted skills, and production environment. Counts do not include unseen provider instructions or server-side framing and are not verified Terra/Sol billing-token counts. Real subscription journey input usage includes additional local Codex configuration and is not a base/head savings comparison.
- Parent review: no new state, dependencies, runtime calls, tool/schema changes, model branches, or capability router. Explicit schedule examples, DST recovery, optimistic concurrency, route restrictions, consent, privacy, browser recovery, and verified-result branches remain. Temporary capture code was restored and is not part of the change.
- The earlier exploratory ReviewGPT consultation informed this implementation. Its recovered response was useful, but its model-confirmation failure remains recorded; it is not a passed final review. This prompt-primary implementation does not independently change a sensitive runtime boundary, so no additional final PR ReviewGPT gate is claimed or substituted for local proof.
- Delivery scope: local implementation and scoped commit. No PR, push, merge, deployment, or public changelog publication was requested. When shipping, describe the appointment/refill instruction consistency in the release note and run the applicable exact-head CI gates. Larger hosted-skill decomposition and static per-turn text relocation remain separate follow-up work.

- `pnpm complexity:diff --base HEAD`: passed for both changed source files; complexity debt and maxima are unchanged. Existing route-builder hotspots (30 and 25) are outside the edited logic; no split is justified for this text-only change.
Completed: 2026-09-04
