# Continue onboarding after optional wearable deferral

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Let a member postpone the optional wearable connection action without
  accidentally postponing the rest of onboarding after they have already
  identified their data source.
- Replace the contradictory broad overlay with one always-visible,
  connection-only transition rule while keeping generic object-scoped defer
  meaning in the onboarding skill.

## Success criteria

- A connection-only deferral advances to the next unresolved foundation beat.
- An explicit request to pause onboarding still stops advancement.
- Murph never claims that a deferred connection is active or syncing.
- Deterministic tests prove the single-owner prompt contract and composite
  connection-deferral transition.
- One focused production-derived real-Codex journey produces a warm, clear,
  single-question continuation with no false connection claim.
- Focused tests, typecheck, exact-head CI, the preliminary Product UX/prompt/
  coverage ReviewGPT pass, and parent final review are complete.

## Scope

- In scope: onboarding prompt ownership, the data-source checkpoint contract,
  focused deterministic tests, one synthetic live journey, and a member-visible
  changelog entry.
- Out of scope: runtime state machines, provider connection behavior, device
  APIs, persisted onboarding state, frontend changes, and unrelated onboarding
  stages.

## Constraints

- Technical constraints: preserve the existing prompt/skill architecture;
  introduce no new dependency, flag, state owner, runtime guard, or opaque
  persisted step marker.
- Product/process constraints: preserve member autonomy, explicit onboarding
  pause behavior, truthful connection status, confidential-source privacy, and
  one-question reply pacing.

## Risks and mitigations

1. Risk: broadening every "later" response could skip an unanswered foundation
   checkpoint.
   Mitigation: scope advancement to a connection-only deferral after the data
   source has already been named; retain the general unresolved rule for a
   checkpoint answer that is itself deferred.
2. Risk: continuing could imply that the provider connected successfully.
   Mitigation: require truthful acknowledgement and forbid active/syncing claims
   until connection evidence is visible.
3. Risk: a prompt-only lexical assertion could miss the user-visible composite
   transition or a resumed turn that does not reload the onboarding skill.
   Mitigation: pair deterministic ownership checks with a multi-turn real-Codex
   journey built from the production prompt and skill assets.

## Tasks

1. Obtain and inspect ReviewGPT's simplify-first patch against the current base.
2. Port accepted hunks at the smallest prompt ownership boundary.
3. Run deterministic prompt, skill-asset, route-planning, and type checks.
4. Run and inspect the focused real-Codex journey; record a Ready/Hold verdict.
5. Add the changelog item, review the final diff, commit, push, and open a draft
   PR with the required evidence.
6. Run the preliminary specialist ReviewGPT pass concurrently with exact-head
   CI, resolve any accepted findings, complete parent final review, close this
   plan, and push the final scoped commit.

## Decisions

- Product UX classification: Patch. The affected person is a direct-onboarding
  member who has named a supported wearable but wants to connect it later.
- The informational checkpoint and optional provider side effect are distinct;
  only an explicit onboarding-level pause stops the overall flow.
- This is prompt-primary and product-owned, so Product UX, prompt, and coverage
  lenses apply. No independent cross-cutting trigger is currently present.
- ReviewGPT's patch was accepted except for its new explicit "connect now"
  gate. The current automatic link handoff remains when a supported source is
  named without a deferral; a same-turn or later connection deferral skips the
  link write and continues onboarding.
- Preliminary ReviewGPT found that a later-turn bare "later" still conflicted
  with generic persistence/completion wording and that the live proof covered
  only the same-turn case. Both findings were accepted.
- Real-Codex remediation proved that a resumed short reply may correctly skip
  on-demand skill reads. The durable minimum is therefore one narrow
  always-visible connection-only transition in the direct onboarding overlay,
  plus one generic object-scoped defer rule in the persistence reference.
  Duplicate connection-only copies were deleted from the stage references.
- The real-Codex proof asserts observable behavior, not a prescribed internal
  reference read: same-turn defer, prior-link bare defer, resolved return, and
  explicit onboarding pause.

## Verification

- Passed: Assistant Engine prompt/model asset and route-planning tests, 200
  passed and 7 skipped.
- Passed: onboarding policy-read detector tests, 3 passed and 131 skipped.
- Passed: Assistant Engine typecheck after the final TypeScript test edit.
- Passed: focused multi-turn real-Codex journey on `gpt-5.6-terra`, 1 passed
  and 133 skipped. Same-turn and prior-link connection deferrals acknowledged
  the choice, made no new device write, emitted no link or false connection
  claim, and continued with one useful foundation question. A fully resolved
  foundation returned to the saved thread without reopening the wearable
  checkpoint. An explicit onboarding pause made no advancement.
  Product UX verdict: Ready.
- Passed: focused changelog page test, 9 passed, and Web typecheck.
- Measured the final serialized-instruction delta against the existing complete
  base request capture: individual 25,683 to 25,716 tokens (+33, +0.13%) and
  117,577 to 117,772 bytes (+195, +0.17%); group input remains 20,775 tokens
  and 94,396 bytes.
- Preliminary specialist ReviewGPT: two accepted findings, both remediated and
  covered above. PR: #2457.
- Passed: required GitHub checks on the remediated exact candidate head,
  including release app verification, Assistant Engine/package coverage,
  build/typecheck, fixture coverage, repository hygiene, provider boundaries,
  and PR evidence.
- Passed: parent final review, `git diff --check`, private-identifier scan, and
  a clean current-base `git merge-tree --write-tree` proof.
Completed: 2026-08-27
