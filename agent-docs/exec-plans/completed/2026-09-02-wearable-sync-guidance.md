# Wearable sync guidance

Status: completed
Created: 2026-09-02
Updated: 2026-09-03

## Goal

- Make Murph proactively account for wearable-data latency when troubleshooting
  missing Apple Health data and when choosing times for scheduled health-data
  summaries, without changing sync mechanics or automation authority.

## Success criteria

- Apple Health troubleshooting guidance tells Murph to ask the member to open
  the Murph app so its Apple Health import can run, then confirm whether fresh
  data appears before escalating.
- In a group, when one participant's missing shared metric is paired with
  consented status proving Apple Health is that same participant's sole
  connected source, Murph asks that participant by their safe display name
  whether the Murph app is open instead of guessing from missing data alone.
- Scheduled summaries that depend on completed-day wearable data prefer a
  next-day delivery time with a reasonable freshness buffer instead of a late
  same-day time that may report an incomplete day.
- Explicit member-specified times remain authoritative; Murph explains or
  clarifies the freshness tradeoff only when it materially affects the result.
- Deterministic prompt regression proof and focused real-Codex journeys cover
  both behaviors and show concise, accurate member-visible replies.
- ReviewGPT inspects the current prompt owners and returns a scoped patch or
  diff; the accepted implementation is reviewed locally, committed, pushed,
  and submitted as a draft PR with required evidence.

## Scope

- In scope: production assistant prompt/instruction owners, prompt regression
  tests, focused real-Codex journey coverage, and a member-visible changelog
  entry if required by the completion workflow.
- Out of scope: device-sync cadence or provider implementation changes,
  background execution changes, new notification authorities, UI changes, and
  guarantees that a provider has completed syncing by a fixed time.

## Constraints

- Technical constraints: keep one prompt-owned source of truth; use existing
  scheduling and device-read contracts; do not add runtime state or new tools.
- Product/process constraints: Product UX Patch. Outcome: members get honest,
  useful recovery guidance and fresher scheduled summaries. Reaches: missing
  Apple Health data conversations, participant-scoped group recovery, and
  wearable-derived reminder/newsletter setup. Proof: production-assembled
  prompt assertions plus separate synthetic real-Codex journeys and manual
  reply review.
- Preserve conversational, non-broadcast messaging and member timing choices.

## Risks and mitigations

1. Risk: an absolute delay rule overrides an explicit member preference or
   needlessly postpones data that does not depend on a completed day.
   Mitigation: scope the preference to model-chosen times for completed-period
   wearable summaries and preserve explicit timing authority.
2. Risk: Apple Health guidance incorrectly tells the member to open the Apple
   Health app rather than Murph, or promises immediate synchronization.
   Mitigation: align the wording with the actual app-owned import path and
   describe opening Murph as the recovery step without promising completion.
3. Risk: broad prompt duplication creates conflicting scheduling policy.
   Mitigation: locate the narrow existing owners and delete or consolidate any
   overlap instead of adding parallel instructions.
4. Risk: group Murph infers or exposes a participant's private source state
   from a missing metric.
   Mitigation: require the same consented shared-read row to prove exactly one
   connected Apple Health source and use only its safe display name; otherwise
   keep the cause unknown.

## Tasks

1. Inspect the complete assembled prompt and current Apple Health,
   device-data, reminder, and group-newsletter instruction owners and tests.
   Completed.
2. Send the scoped task and relevant files to ReviewGPT, wait for its attached
   patch/diff, add the participant-scoped group recovery requirement, and
   validate the proposal against current repo invariants. Completed.
3. Apply or adapt the smallest correct prompt patch and add deterministic
   regression coverage. Completed.
4. Add and run focused real-Codex journeys for Apple Health recovery and
   next-day wearable-summary scheduling; review the actual replies. Completed.
5. Run focused tests, typecheck, prompt-input measurement, complexity, diff,
   Product UX walkthrough, and parent final review. Completed.
6. Commit through the plan-aware workflow, push, open a draft PR, and wait for
   required exact-head CI; run the user-requested ReviewGPT authoring pass as
   routed. Completed.

## Decisions

- Treat this as a Patch because it restores accuracy and recovery within two
  existing journeys and does not create a new product promise.
- Interpret the operational Apple Health recovery step as opening the Murph app
  so Murph's import can run; do not instruct the member that merely opening the
  Apple Health app triggers Murph's sync unless code evidence proves otherwise.
- Reuse the consented `device-sync-status.v0` group projection as the sole
  authority for naming Apple Health in a group. A missing metric alone never
  proves a provider, disconnection, permission problem, or recovery step.
- Treat "only connection" as exactly one source whose current status is
  connected. Other explicitly disconnected source rows do not block the
  recovery suggestion.
- Keep the current managed group-newsletter unavailable contract intact. The
  shared timing guidance applies to supported automations and remains present
  in group prompt assembly without inventing newsletter capability.

## Verification

- Commands to run: focused prompt tests; package typecheck; focused
  `pnpm test:assistant:live` journey patterns; `pnpm complexity:diff`;
  `git diff --check`; exact-head required PR CI.
- Expected outcomes: assembled instructions contain the bounded freshness and
  recovery guidance once, tool effects match the requested automation, actual
  replies are truthful and concise, and all routed checks pass.

## Results

- ReviewGPT inspected the prompt owners and proposed direct recovery,
  retrospective summary timing, and same-row group recovery rules. The parent
  adopted the same-row and exactly-one-connected-source boundary, retained the
  existing unavailable newsletter contract, and tightened the one-read rule
  after the first live group journey repeated the same read.
- Deterministic prompt coverage passed 103 tests across the system-prompt,
  capability, and group shared-health owners. Assistant Engine and hosted Web
  typechecks passed. The focused changelog suite passed 9 tests. The complexity
  diff passed with no new debt.
- The complete route-plan characterization passed 102 tests after its direct
  and scheduled-email prompt digests were refreshed for the intentional prompt
  change. Required exact-head PR CI then passed 33 checks with 2 skips and no
  failures.
- Real Codex reply review is Ready for direct Apple Health recovery, group
  recovery, a completed weekly wearable summary scheduled Monday at 10:30 AM
  local time, and preservation of an explicitly requested midnight reminder.
- Product UX replay: a direct member gets the Murph-app recovery and a dated
  re-check; a group uses one paired read and asks only the correctly named
  participant; a model-chosen completed-period summary waits until the next
  morning and stores freshness and unknown-not-zero rules; action-timed cues
  and exact requested times remain unchanged.
Completed: 2026-09-03
