# Diagnose and repair canary delays, vault sharing, and Android SDK setup

Status: active
Created: 2026-09-28
Updated: 2026-09-28

## Goal

Diagnose and correct reproducible causes of delayed canary replies, deferred
vault-share delivery, and Android SDK setup failure. Preserve reply and share
authority, durable accepted work, meaningful canary budgets, and provider privacy.

## Success criteria

- Each symptom has a proven cause, an independently verified existing correction,
  or an explicit evidence/ownership boundary with the tested hypotheses recorded.
- Corrections pass focused before/after proof and the current review/CI gates.
- Functional corrections remain ready for human merge; production checks are
  read-only and do not send messages or replay work.

## Scope

- In scope: existing reply timing and canary owners, runtime vault-share
  projection/delivery owners, exact Android controller/source SDK configuration.
- Out of scope: unrelated production sweep findings, device sync, changing
  canary budgets to conceal latency, new monitoring infrastructure, production
  state/configuration changes, and foreign branches without a handoff.

## Constraints

- Prefer removing or reordering work at its current owner over new machinery.
  Do not change canonical state, retry, concurrency, or authority based on an
  unproved historical explanation.
- ReviewGPT implements substantive corrections. Keep production evidence out of
  packets and fixtures; use synthetic cases and bounded metadata aggregates.
- The user's explicit follow-up covers all three problems and supersedes the
  completed scheduled sweep's one-change limit. It does not grant functional
  merge/deployment or provider-write authority.

## Risks and mitigations

1. Existing repairs may own a matching cause. Inspect actual diffs and heads;
   obtain explicit ownership handoff before modifying another task's work.
2. Absent telemetry may conceal incomplete work. Follow exact attempts and
   source versions; never infer recovery from later unrelated success.
3. Native source pins include more than SDK setup. Inspect the exact source and
   existing reviewed correction before choosing a public controller change.

## Tasks

1. Establish current source, observed failure boundaries, and actual PR overlap.
2. Trace slow canary turns through existing ingress/provider/tool/delivery timing
   and reproduce avoidable work through the composed owner.
3. Exercise vault-share generation, pagination and durable retry transitions;
   query the existing reason observation and prove missing outcome or recovery.
4. Verify Android's failed SDK package and corrected pinned source. Resolve
   existing repair ownership before any mutation.
5. Implement the smallest supported corrections, inspect privacy/runtime cost,
   run focused proof, and complete scoped commits and required PR review/CI.

## Decisions

- Start from fresh main in an isolated task checkout. Preserve unrelated local
  edits and open PR worktrees.
- Android controller rotation is already proposed in PR #3720. Its exact diff
  points to a native source change adding explicit SDK package selection;
  ownership handoff is pending while independent investigation continues.

## Verification

- Select composed route/runtime tests and typechecks after locating the cause;
  preserve a failing baseline for each authored functional correction.
- Run native source/controller contract checks for an SDK correction, without
  dispatching a protected production journey from this task.
- Parent candidate review, applicable product/assistant evidence, complexity,
  logging/docs checks, final ReviewGPT and required exact-head CI.

## Product UX plan

- Outcome: a custom weekday goal stays tied to the member's request, with no
  substitute public-template lineage or repeated discovery after a complete miss.
- Reaches: new custom proposals and their immediate acceptance; exact public
  matches keep their current freshness and accepted-write requirements.
- Proof: existing composed goal boundary tests and real Luna walking journey,
  including no proposal writes, one Goal and linked regimen on acceptance,
  accepted start/cue, no reminders, and no false public lineage.

## Investigation update

- Bounded runtime timing localizes the slow observed turns primarily inside
  provider execution, not admission, command runtime, or final delivery.
  Temporal association with canary turns is strong but not an exact identity join.
- The unchanged synthetic walking journey reproduced two public-goal searches
  and the wrong public-template lineage, failing its existing custom-goal
  assertion. Proposal took 31.7 seconds and acceptance 17.1 seconds; these are
  single local measurements, not a production performance guarantee.
- The public Walk Every Day title, goal phrase, and aliases do not exactly match
  the fixture's requested afternoon-energy/weekday walking outcome. Existing
  rules forbid substitutes but lack one consolidated discovery stopping point.
- All runtime-projectable active shares are materialized. Observed version lag
  is at most one; null records belong only to non-runtime projection kinds.
  Focused route/store and composed retry tests preserve generations, pagination,
  deadlines, foreground interruption and durable completion. Historical deferred
  requests still lack exact reason/outcome correlation; deployed reason telemetry
  is the next observation, not authority to relax generation fences.
- ReviewGPT implementation requested for the goal stopping/custom-lineage rule.
  The stock browser adapter failed before submission; the existing tooling PR's
  installed patch passed a read-only reverse-application provenance check.

## Implementation and focused proof

- Refreshed the unpublished branch to main after the independent ReviewGPT
  tooling correction merged. The goal skill and canary fixture were unchanged
  by that base refresh; unrelated event-list coverage also arrived.
- Recovered the exact accepted ReviewGPT implementation through its original
  capture metadata. Parent review accepted the three-file instruction/test patch.
- Eight goal-boundary tests pass; the new assertions fail against the old skill.
  Assistant-engine typecheck and complexity guard pass.
- First corrected live proposal took 18.3 seconds, one public search and no
  template show; a focused diagnostic repeated that result at 16.7 seconds.
  Acceptance took 17.5 and 14.1 seconds but repeated the same public search,
  so the strengthened journey remains Hold. The diagnostic proved both turns
  used the same Murph session and saved one custom Goal with a linked quiet plan.
- Follow-up ReviewGPT implementation targets that immediate-acceptance branch.
  Do not weaken the failing assertion or claim the 20-second production budget
  is guaranteed from these local samples.
- Changelog copy uses the unchanged archive presentation; generator and ten
  production archive tests pass. Source PR provenance will be filled at creation.

## Refined candidate evidence

- ReviewGPT's follow-up makes immediate acceptance an explicit entry branch,
  retaining required-fact recovery and exact-template freshness. Parent review
  accepted its two-file refinement without additional production edits.
- Final custom walking journey passes: one public search, no template show, no
  proposal writes; acceptance issues exactly one Goal save and one regimen save,
  with custom lineage, accepted next-weekday start and no reminders. Actual
  replies were reviewed. Proposal 30.354 seconds, acceptance 18.367 seconds.
  The proposal still exceeds the production budget in this local sample; the
  correction removes proven excess work but does not resolve all latency.
- Eleven deterministic goal/Commons tests, assistant-engine typecheck, complexity
  and docs-drift checks pass. Changelog generation and ten archive tests pass.
- Exact public-template control passed resolution, grounding order and no-write
  checks but asked two questions in the initial candidate. Unchanged baseline
  passed with one; final refined-candidate control is pending. No claim that
  the earlier control failure was proven pre-existing.
- Android remains a proven duplicate of PR #3720; handoff is still pending.
  Vault generation/retry behavior passed 410 focused tests; historical deferred
  attempts lack exact outcome correlation. Existing reason observation remains
  the follow-up route, with no new functional share change justified.
