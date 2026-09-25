# Reduce goal setup turn latency

Status: active
Created: 2026-09-24
Updated: 2026-09-24

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

Goal-setup and follow-through instructions, routing, and focused regression evidence. No model, transport,
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
