# Reduce goal setup turn latency

Status: active
Created: 2026-09-24
Updated: 2026-09-25

## Goal

Reduce unnecessary model round trips during natural goal proposal and acceptance,
then verify the production canary without changing its 20-second reply budget.

## Success criteria

- Successful accepted plans retain exactly one active Goal and linked habit regimen.
- Quiet support creates no automation; ownership, consent, lineage freshness, and
  partial-failure recovery remain enforced.
- Focused deterministic checks, typecheck, and the real Luna journey pass.
- Merge the verified fix and observe the protected production canary.

## Scope

Goal-setup and follow-through instructions, routing, native tool loading, and focused regression evidence. No model, transport,
canary threshold, or production credential changes.

## Evidence and decisions

- Production canary acceptance took about 54 seconds. Seven successful commands
  totaled about 6.6 seconds; transport took less than one second. Most time was
  between model actions, rather than command execution or message delivery.
- The goal-setup skill requires post-save Goal and regimen reads even though the
  system prompt treats successful save receipts as confirmation. Retain reads
  for ownership, missing state, and partial-failure recovery.
- Measure synthetic command names and elapsed time before and after changing
  instructions. Production timings are aggregate evidence, not a transcript.

- The canary's old acceptance requested tomorrow after a weekday-only proposal.
  On Friday that means Saturday; use an explicit next-weekday acceptance.
- Root guidance treated all setup acceptance as conversation-only and routed
  ordinary plans to strength or experiment skills. Distinguish a setup invitation
  from acceptance of a final proposal, and route everyday walking to daily activity.
- Synthetic acceptance exposed an unnecessary exact-time question for quiet
  cue-based support and retries from an overlong regimen schedule. Keep the cue;
  constrain schedule to timing and store plan detail in the regimen note.
- Native thread continuity is retained. Repeated research is not explained by a
  lost provider thread. Local runs varied; a passing run is not a speed guarantee.
- Follow-through loaded 53 KB even for a fresh quiet plan. Move its unchanged
  delivery, automation, repair, and closeout guidance into a conditional reference;
  preserve consent, grounding, plan ownership, and stop rules in the setup file.
  Existing quiet plans and all support effects still require the reference.

## Risks and mitigations

- Removing ownership checks could duplicate or overwrite plans: preserve bounded
  inventories and detail reads for plausible existing matches.
- Quiet support on an existing regimen may need reconciliation: preserve its
  inventory; skip only when a successful receipt proves a newly created owner.
- Local model timings differ from hosted service: require deployed canary proof.

## Tasks

1. Measure the focused synthetic baseline and inspect actual actions.
2. Remove proven redundant work in the owning instructions; update regression proof.
3. Run deterministic checks, typecheck, and focused real-Codex proof.
4. Review, merge, and verify production deployment and canary.

## Verification

- Focused goal, skill, model-behavior, capability-offer, and dynamic-context tests pass;
  assistant-engine and Web typechecks pass. Docs drift/gardening and complexity pass.
- Follow-through setup is 26,945 bytes versus 53,038 bytes previously. The 27,041-byte
  support execution reference preserves its moved policy verbatim.
- Complete provider request capture (gpt-6-luna; same tools/history; transport cache
  key excluded): individual 151,498 -> 151,921 bytes; group 139,579 -> 140,005 bytes.
  Exact Luna tokenizer unavailable, so no token-count claim.
- Live natural-plan timings remain variable. Native thread continuity and complete
  goal-skill output were verified; repeated empty searches still occur in some runs.
  Local functional proof does not assert incidental discovery choices or stand in
  for the deployed canary's unchanged 20-second budget.
- The existing deep-sleep finite-support journey fails its exact-lookup assertion
  on both the earlier merged candidate and this branch with Luna. This is a
  pre-existing proof gap, not passing reminder-persistence evidence.
- A narrower support-proposal journey exposed a missing shared exercise reference
  in its synthetic fixture. Add the shipped asset and track the repair in Frog.
- Final local Luna quiet-plan proof passes: no proposal writes; exactly one custom
  Goal and one linked active habit regimen after acceptance; no reminders and no
  redundant post-save shows. Proposal 31.7 seconds and acceptance 15.6 seconds on
  a busy local host. Empty public discovery still repeated once; no guarantee of
  every inference step or hosted latency is claimed.
- The narrower reminder-proposal proof passes after the fixture asset repair,
  with a support offer and zero unaccepted writes or runtime issues.
- Candidate committed and draft PR #3700 opened. Release note added for quiet-plan
  setup, without promising a response-time threshold.
- Broad CI found seven stale test expectations across six files after the policy
  move and routing edits. Extend the existing whole-owner policy reader to the
  follow-through reference and refresh the three changed prompt fingerprints.
  The focused seven-file regression run passes all 170 tests.
- Pending exact-head CI, deployment, and protected production canary.

## Deployment follow-up

- PR #3700 merged after exact-head CI passed. Protected runtime deployment passed
  all predeployment checks and verified live fleet convergence.
- Web admission was blocked by an independent alert-monitor fixture: the merged
  60-second alert threshold no longer classifies its two 31-second samples as
  anomalous. The real cron therefore returns healthy instead of exercising the
  failed-send and recurrence assertions. Update both samples to 61 seconds;
  preserve the alert threshold and production canary budget.
- Production Web promotion and the protected canary remain pending.

- PR #3703 merged after CI passed, repairing the alert fixture. Web admission
  will run normally on that successor commit.
- The next protected canary on the deployed runtime passed proposal at 14.8s
  but failed acceptance at 30.2s. Acceptance used three successful command
  actions totaling about 2.9s; the remaining time is primarily model execution.
- Use the existing CLI batch to execute the already-authorized Goal save and
  subsequent regimen inventory together. Preserve their order and inspect both
  results before the dependent regimen write; preserve partial-failure recovery.
  This changes no CLI API or canonical state ownership.

- A synthetic Friday replay exposed a separate acceptance failure: the model
  treated shifting a quiet plan to the next weekday as requiring a second yes
  to make the relative first-week review date explicit. Anchor relative quiet
  plan/review windows to the accepted start. Preserve fixed-date and reminder
  consent gates; do not repeat permission solely for relative date arithmetic.

- Reject the experimental batching guidance: a concrete command example caused
  a synthetic proposal-turn write before acceptance. It is not shipping. Keep
  the relative quiet-date correction scoped to the existing acceptance boundary.

- Web admission and full private integration now pass for PR #3703; both
  production Web aliases resolve to its admitted revision.
- The date-only replay preserved proposal consent and persisted the accepted
  start, but incorrectly attached a related public sitting template. Clarify
  that background desk work is not the requested goal. Keep the custom-lineage
  assertion; do not approve the failing replay.

## Follow-up Product UX

- Outcome: save an accepted quiet plan with its requested start and goal.
- Reaches: relative first-week/review shifts and background context during public
  discovery. Fixed-date commitments, reminders, and exact public matches retain
  their existing consent and lineage gates.
- Proof: focused exact-resolution/date policy checks and real Luna natural-plan
  journey, then exact-head CI and the unchanged production canary. Status: Ready for local UX;
  production latency proof remains pending.

- Follow-up candidate: eight focused goal-skill checks and assistant-engine
  typecheck pass; complexity guard passes with no authored JS/TS source changes.
  The default local subscription failed before provider action with routing 401;
  the established authenticated test profile completed the focused Luna replay.
  It made no proposal writes, saved exactly one custom Goal and one linked habit
  regimen after acceptance, and created no automation. Native acceptance took
  about 13.7 seconds; its reply correctly placed the start on Monday and the
  relative review on the following Friday without another consent question.
  This is local behavior evidence, not a passing deployed canary.

## Secondary-tool loading follow-up

- PR #3704 merged; protected runtime deployment, live fleet convergence, and Web
  admission passed. A subsequent canary passed with first proposal/acceptance
  replies at 12.4/14.0 seconds and canonical Goal counts 0/0/1. Those were progress
  replies: acceptance completion still took about 51 seconds. Other same-release
  runs failed at 45 seconds for proposal and 40 seconds for acceptance.
- Commands account for only a few seconds. Complete production requests include
  about 167 KB of eager tool guidance. Keep the canonical JSON supplement, runtime
  validation, availability, and authorization; use native deferred discovery for
  eight specialized media, feedback, family, phone-call, and physical-note tools.
- Outcome: reduce unrelated initial model context while preserving specialist
  actions and ordinary accepted-plan persistence.
- Reaches: private and group initial tool exposure. Progress, reply targeting,
  cancellation/recovery, device and personalization tools stay eager. No new
  state owner, provider call, model setting, permission, or schema is introduced.
- Proof: real pinned native complete-input capture, whole-inventory schema guards,
  a real Luna deferred song discovery/attachment journey, and the natural goal
  proposal/acceptance journey. Production completion latency remains unproven.
- Synthetic hosted capability fixtures, identical prompt/history, complete first
  Luna request excluding only the transport cache key: private 266,395 to 221,094
  bytes (-45,301; -17.0%); group 217,749 to 177,366 (-40,383; -18.5%). No exact Luna
  tokenizer is available. These are request-size measurements, not latency claims.
- Existing thread-contract fingerprints already force one bounded-transcript
  reconstruction for changed descriptors; subsequent turns resume normally.
  Deployment adds no persistent-schema or inter-service compatibility requirement.

- Candidate proof: 18 native input-contract checks and 165 focused policy/tool/
  planner checks pass, as do assistant-engine typecheck, prepared runtime build,
  complexity, and diff checks. Only direct/group route fingerprints changed.
- Real Luna deferred mixed-mode song proof passes in 7.3 seconds: one generation,
  one attachment, canonical duration limit honored, no forbidden effects; Ready.
- Natural goal replay passes: zero proposal writes, then one custom Goal and one
  linked active habit with no automation. Proposal 24.3 seconds, acceptance 14.3
  seconds locally. Its smaller local capability inventory is not a production
  latency benchmark. Both replies are truthful and require no extra date consent;
  Ready. The broader production latency outcome remains pending.
- Parent candidate review: eight literal loading flags only; canonical schemas,
  runtime handlers, availability/consent gates, and cancellation/recovery policy
  are unchanged. This prompt-primary change uses the existing completion-review
  exemption; no independent backend/protocol change is introduced. No new public
  speed claim is warranted from input-size evidence alone.
