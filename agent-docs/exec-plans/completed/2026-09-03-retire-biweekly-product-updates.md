# Retire biweekly product updates automation

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Stop Murph from creating or sending the built-in biweekly product-notes
  automation while preserving the existing on-demand product-update answer.

## Success criteria

- The biweekly product-notes seed is absent from the managed automation
  registry.
- Reconciliation archives any persisted copy with the immutable historical id,
  including paused copies, and a claimed occurrence fails closed before model
  or delivery work.
- Deterministic managed-automation coverage and one focused production-derived
  real-Codex journey prove the retirement boundary.
- The architecture contract and public changelog describe the shipped outcome.
- Focused tests, assistant-engine typecheck, Web changelog proof, and Web
  typecheck pass.

## Scope

- In scope: the built-in biweekly product-notes seed, its immutable retirement
  tombstone, affected managed-automation tests, assistant live proof, owning
  architecture text, and one public changelog item.
- Out of scope: on-demand product-update guidance, feature-catalog and
  changelog lookup tools, member-created automations, and other built-in
  schedules.

## Constraints

- Technical constraints: keep the historical automation id stable; reuse the
  existing retired-id reconciliation and claim fences; add no new state owner,
  migration queue, or schedule mechanism.
- Product/process constraints: use synthetic private-free evidence, preserve
  direct-route authority for all remaining member automations, and follow the
  assistant verification and changelog workflows.

## Risks and mitigations

1. Risk: removing only the seed leaves an existing member's persisted schedule
   active.
   Mitigation: move the immutable id to the permanent retirement set and prove
   reconciliation archives both active and paused records.
2. Risk: a previously claimed occurrence reaches the model or delivery after
   retirement.
   Mitigation: keep the id in the host-owned retired-id fence and assert the
   occurrence fails closed before provider work.
3. Risk: retiring product notes accidentally removes Murph's ability to answer
   a direct question about recent changes.
   Mitigation: leave the product-update guidance and lookup owners unchanged;
   restrict source edits to the managed seed and retirement registry.

## Tasks

1. Inventory all production and test references to the product-notes managed
   identity.
2. Replace the current seed with a permanent retirement tombstone and update
   the owning architecture contract.
3. Replace active-schedule expectations with deterministic retirement
   coverage, then add one focused production-derived real-Codex journey.
4. Add a concise public changelog item and run its content-only proof.
5. Run focused tests and typechecks, perform the Product UX walkthrough and
   privacy/diff review, then complete the PR workflow.

## Decisions

- Product UX level: Product change. This removes an existing scheduled message
  rather than creating a new audience or authority relationship.
- Changelog: updated. Members can experience the absence of a recurring
  product message, and the safe public outcome is useful to state.

## Product UX plan

- Outcome: members no longer receive unsolicited biweekly product notes from
  Murph, while they can still ask what changed whenever they choose.
- Entry and promise: reconciliation is the entry for existing and new member
  vaults. Existing persisted copies are archived; new vaults receive no such
  seed. There is no replacement message or delayed continuation.
- Affected people: an existing member with an active or paused historical copy,
  and a new member with no persisted copy. Both retain ordinary direct
  conversation and all unrelated authorized automations.
- Challenge: a seed-only deletion would fail existing members because their
  stored automation could keep running. The permanent tombstone is therefore
  required even though no new schedule is created.
- Proof path: reconcile a synthetic vault containing active and paused copies,
  verify both become archived, verify a retired claimed occurrence never enters
  the provider path, and verify a fresh managed seed inventory omits the id.
- UX finish: silence is the observable result; no new UI, fallback message, or
  substitute nudge is introduced.
- Done when: new and established members cannot receive this built-in recurring
  note, existing copies close without manual repair, and direct product-update
  questions remain outside the changed path.

## Verification

- Passed: `managed-automations-core.test.ts` (44 tests),
  `managed-automations.test.ts` (57 tests), `assistant-cron-runtime.test.ts`
  (216 tests), `assistant-product-feedback.test.ts` (14 tests),
  `managed-automations-recovery-readiness.test.ts` (3 tests), and
  `assistant-codex-scripted-runtime.test.ts` (111 tests).
- Passed: the non-live `assistant-codex-real-e2e.test.ts` suite (25 tests, 187
  gated journeys skipped) and assistant-engine typecheck.
- Passed: `pnpm test:assistant:live -- --test "retired product notes leave
  on-demand updates available"` with an authenticated alternate Codex home
  after the default profile was quota-blocked before provider action. The one
  provider request made one canonical changelog call and returned both requested
  on-demand updates without recurring-note language.
- Passed: `pnpm --dir apps/web test -- changelog-page.test.tsx` (9 tests) and
  Web typecheck.
- Post-plan PR gates: exact-head CI and the required final ReviewGPT review run
  on the pushed candidate.

## Product UX walkthrough

- Existing active copy: normal reconciliation archives the exact historical
  built-in ID without rewriting its route, cadence, instructions, or user-owned
  records.
- Existing paused copy: normal reconciliation archives it as well, so pausing
  cannot preserve a future recurring send.
- Claimed occurrence: the runtime returns `managed_automation_retired` before
  lifecycle, provider, or delivery work.
- New member: the active seed inventory omits the historical ID, so no new copy
  is created.
- Direct question: the real-Codex journey read the canonical changelog once and
  answered the requested product-update question normally.
- Differences from plan: none. No replacement message, new UI, or new state
  owner was introduced.
- Result: Ready.
Completed: 2026-09-03
