# Automatically upgrade automation model versions

## Outcome and protected invariants
Existing reminders and automations follow reviewed OpenAI model replacements on their next execution after runtime deployment: GPT-5.6 Luna to GPT-6 Luna; GPT-5.6 Sol and Terra to GPT-6 Sol. Preserve canonical records, timing, occurrence/retry identity, explicit reasoning, conversation selection, provider authority, and custom inference.

## Owner and evidence
`assistant/automation/target-override.ts` owns scheduled target resolution. It currently upgrades Terra during generic compaction, while Luna and Sol remain pinned. Generic compaction also builds provider-neutral envelopes; upgrades belong after the execution provider is known. Reuse the existing routing and session-continuity owners with an explicit replacement map. No new state, scanner, network request, dependency, or deployment hook.

## Product UX
- Outcome: Existing scheduled work uses the current corresponding managed model without recreation.
- Entry and promise: An existing saved automation becomes due; the deployed runtime resolves its model before provider execution.
- Journeys: Legacy Luna/Sol/Terra; explicit reasoning; unchanged current/unknown models; no-override inheritance; explicit provider changes; Venice and custom inference; retries and the subsequent ordinary conversation turn.
- Proof: Composed envelope/routing/continuity tests and a focused real-Codex scheduled reply using the resolved target. Stored pins and schedules remain unchanged; inspection continues to expose the authored pin.
- Decision: Resolve upgrades at execution and retain the authored canonical record; no bulk or next-run rewrite.
- Done when: Correct provider target, preserved durable state and next-conversation target, passing focused checks and exact-head CI, final external review, reviewable PR.

## Deploy and failure contract
Runtime-only activation after GPT-6-capable catalog and allowance readers are deployed (already shipped). Mixed runtime versions may resolve the same old pin differently during rollout; no new persisted format is written. Rollback restores previous resolution. Provider failures retain ordinary retry behavior and never select an unrelated provider. Future upgrades require an explicit reviewed map entry rather than model-name guessing.

## Steps
- [x] Extend provider-aware target resolution and add regressions that fail first.
- [x] Add the production-derived scheduled journey and prove ordinary conversation-target continuity.
- [ ] Obtain live reply proof: all available local subscription homes are blocked before provider action.
- [x] Update architecture/changelog, review the complete diff, run typecheck and complexity.
- [x] Open [PR #3670](https://github.com/cobuildwithus/murph/pull/3670) as draft and close the implementation plan with the verification hold recorded.
- [ ] Release gates remain pending: live reply proof, final ReviewGPT, and green required exact-head CI.

## Evidence
Six new regressions failed before the implementation. The final focused automation lane passes 50 tests across model selection, continuity, fresh-session routing, and envelope construction. Assistant Engine typecheck, `pnpm complexity:diff` (maximum 20, no hotspots), and `pnpm docs:drift` pass. Changelog generation and its 10 page tests pass. The adjacent onboarding first-personal-read lane also passes all 10 tests; reasoning-only overrides continue inheriting the selected target.

Live command: `pnpm test:assistant:live -- --test "runs a saved legacy Luna reminder on the current OpenAI model without rewriting it" --model gpt-6-luna`. Auth class: local subscription. The default home and all nine available alternate homes failed before provider action (quota, authentication, or startup failure). No real reply was produced; Product UX verdict is Hold. Do not count the scenario as passed. The authored live test compiles and remains opt-in.

No production deployment or canonical record mutation is part of this PR task. The implementation is reviewable, but final external review and required CI are pending while the direct proof hold remains open.

## Handoff
Implementation is complete in draft PR #3670. The external verification hold is intentionally unresolved: rerun the recorded focused Luna journey when local subscription access is available, inspect its actual reply, then continue final ReviewGPT and required exact-head CI before readiness. No merge or deployment was performed for this task.
Status: completed
Updated: 2026-09-23
Completed: 2026-09-23
