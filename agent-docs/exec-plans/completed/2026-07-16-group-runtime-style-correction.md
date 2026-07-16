# Group-runtime style correction

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Correct the merged group-style feature so an authenticated group-chat
  request reads or changes that group runtime's own Tone, Voice, Humor, Push,
  and Detail settings, never the speaking member's private Murph settings.

## Success criteria

- The synthetic thread-container runtime is the only style owner selected by a
  group-chat tool invocation; no participant identity is resolved or mutated.
- Tone, Voice, Humor, Push, and Detail use the existing hosted style contracts,
  web projection, mailbox convergence, and canonical group vault.
- Direct/private Murph settings remain member-owned and unchanged.
- Unauthenticated group-email and non-group contexts cannot mutate room style.
- No web UI, schema, second settings store, or group-specific parallel mutation
  pipeline is added.
- Focused owner tests, required coverage, full verification, CI, and ReviewGPT
  pass with no unresolved accepted finding.

## Scope

- In scope: deletion of the merged sender-to-member path, group runtime tool
  planning and prompt guidance, signed personalization/style callbacks for a
  thread-container owner, current-input causal binding, focused tests, and
  matching durable architecture/security/product docs.
- Out of scope: model or reasoning configuration, participant-private settings,
  room settings UI, unauthenticated group email, and arbitrary runtime/member
  selection.

## Constraints

- Reuse the synthetic thread-container's existing hosted member row and vault;
  do not add a group settings table or new identity selector.
- Keep model-supplied arguments limited to validated setting values.
- Preserve exact accepted-input authority and field-local ordering.
- Preserve unrelated active lanes and the already-completed historical plan.

## Risks and mitigations

1. Risk: the correction could still write a participant's private settings.
   Mitigation: delete sender injection and member lookup entirely; bind every
   callback to the active runtime's thread-container identity.
2. Risk: a group style write could escape the authenticated group-chat route.
   Mitigation: keep tool registration audience-gated and reject group email or
   unverified audience contexts before the operation is exposed.
3. Risk: current-turn confirmation could claim a value before canonical
   convergence or use the wrong causal sequence.
   Mitigation: reuse the existing accepted-input-bound web transaction and
   invocation overlay; the setting applies on the next separately planned turn.
4. Risk: a best-effort runtime wake could fail after the room preference event
   commits and leave the update waiting indefinitely.
   Mitigation: include active synthetic room runtimes in the existing bounded
   preference-handoff sweep, with owner-or-participant access before the limit
   and canonical access rechecked before signaling.
5. Risk: web, Worker, and warm runner versions can disagree during rollout.
   Mitigation: document the safe deployment order and use immediate runner
   convergence when the shared action contract changes.

## Tasks

1. Trace the merged implementation and existing thread-container preference
   owner end to end; prove the smallest no-schema correction.
2. Delete the participant-resolution contract/runtime/web path and expose the
   existing personalization/style operations against the group runtime owner.
3. Update focused authorization, ownership, causal-ordering, prompt, and
   regression tests.
4. Correct durable architecture, security, product, and command docs so they
   describe room-owned behavior.
5. Run required verification and audits, parent final review, close the plan,
   commit, push, open a corrective PR, and complete CI plus ReviewGPT.

## Decisions

- Group-chat style is canonical to the synthetic thread-container's own vault;
  its hosted-member style columns are the existing web projection.
- The human sender is not an ownership input for this feature. Any participant
  admitted to the authenticated group conversation may ask that room's Murph
  to change its style.
- The current tool call cannot restyle the reply already in progress. The
  returned effective snapshot supports truthful confirmation, and the new
  values enter prompt/voice planning on the next turn.

## Verification

- Focused assistant-engine planning, prompt, dynamic-tool, and skill tests:
  155 passed across the five directly changed suites.
- Full assistant-engine isolated package pass: 2,293 passed and 5 skipped.
- Full assistant-runtime isolated package pass: 1,730 passed and 2 skipped.
- Focused hosted-web personalization, group-boundary, mailbox-authority,
  model-boundary, and preference-recovery tests: 164 passed.
- Full hosted-execution package pass: 350 passed.
- Affected package/app typechecks: 10 workspace projects passed.
- Coverage-write added the room-owner success and authority-failure matrix,
  selector rejection, wake lookup, and container model-boundary cases.
- Scoped hosted-web coverage: 47 tests passed; 98.12% statements and 90.05%
  branches.
- Scoped assistant-engine coverage: 128 tests passed; 95.84% statements and
  92.33% branches.
- Prompt, security/authority, recovery, coverage-write, and parent final-review
  passes found no unresolved blocker.
- `pnpm docs:drift` and `git diff --check`: passed.
- `pnpm test:diff` passed all guards and affected typechecks. Its broad local
  fan-out could not produce one clean completion: parallel runs exhausted
  unrelated scripted-runtime time budgets, while a one-worker run passed the
  full engine and runtime packages but starved an unrelated CLI command timing
  test. The changed suites above pass cleanly; PR CI remains the fresh-runner
  broad verification gate.
- Post-push CI and ReviewGPT: required before merge readiness.
Completed: 2026-07-16
