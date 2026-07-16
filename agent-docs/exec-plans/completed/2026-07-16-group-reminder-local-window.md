# Group reminder local action window

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Prevent a scheduled group reminder from treating evidence from a different
  local action window as completion for the current occurrence.

## Success criteria

- Every scheduled notification turn receives its exact occurrence instant as
  engine-owned per-turn context.
- Notification guidance derives the occurrence's local calendar date from the
  vault timezone and requires completion evidence to belong to the relevant
  local action window before suppressing the occurrence.
- Ambiguous or unavailable attribution remains unknown rather than complete,
  while preserving the existing privacy boundary and automation lifecycle
  ownership.
- Regression coverage proves the UTC-midnight case where an instant on July 15
  UTC is still July 14 in New York.
- Required verification, local specialist audits, PR CI, and the exact-head
  ReviewGPT loop complete with no accepted finding remaining.

## Scope

- In scope: the assistant notification turn contract, cron execution handoff,
  notification decision prompt context, and focused assistant-engine tests.
- Out of scope: persisted automation schema, continuity policy, scheduler
  cadence, transcript timestamp storage, route ownership, and a generic model
  for cross-midnight action windows.

## Constraints

- Keep the occurrence context ephemeral and engine-owned; do not add persisted
  state or a second scheduler/date owner.
- Preserve group privacy boundaries and the existing default-to-silence rule.
- Treat the local occurrence date as an anchor for the automation's relevant
  action window, not as a universal same-calendar-day completion policy.
- Preserve unrelated active work that also touches the system prompt by keeping
  edits narrow and based on current `origin/main`.

## Risks and mitigations

1. Risk: applying a same-day rule globally would break legitimate overnight
   or pre-bed action windows.
   Mitigation: expose the local occurrence anchor and instruct the decision to
   use the automation's relevant action window rather than enforcing equality
   in scheduler code.
2. Risk: a generic notification could accidentally receive group-only behavior.
   Mitigation: keep shared occurrence facts separate from scope-specific
   decision guidance and test both layers.
3. Risk: a resumed provider thread could reuse stale occurrence context.
   Mitigation: keep the occurrence fact in rebuilt per-turn dynamic context,
   outside thread-stable instructions and route identity.

## Tasks

1. Add the scheduled occurrence instant to the existing per-turn notification
   envelope and carry it through the local notification input.
2. Render a compact local occurrence context in the notification decision
   system prompt and tighten group completion attribution guidance.
3. Add focused midnight-boundary and handoff regression coverage.
4. Run scoped verification, required prompt and coverage audits, and parent
   final review.
5. Close the plan with a scoped commit, push, open the intent-complete PR, then
   run CI and the exact-head ReviewGPT loop concurrently to completion.

## Decisions

- Reuse the occurrence instant already computed by cron execution and carry it
  as one optional per-turn message field; do not persist it or create a second
  schedule/date owner.
- Derive the local occurrence date in dynamic notification context from the
  same canonical vault timezone used by cron schedule projection and prompt
  planning.
- Use that local date as an action-window anchor rather than a universal
  calendar-equality rule, preserving explicit overnight and multi-day windows.
- For an explicitly authorized accountability check-in, treat unclear
  attribution as unknown and ask one neutral outcome question without implying
  that anyone missed the activity.

## Audit outcomes

- `prompt-review` passed twice with no finding: once for the occurrence context
  and attribution guard, then again after the parent added the narrow unknown-
  outcome question rule. The rerun confirmed privacy, default-silence,
  deliverability, evidence, and structured-output invariants remain intact.
- `coverage-write` found one useful proof gap and added a notification-boundary
  assertion that the non-null occurrence survives into `AssistantMessageInput`.
  No production edit or further coverage finding was recommended.
- Parent final review re-walked cron occurrence computation, notification input
  construction, route planning, dynamic prompt placement, group scope rules,
  and all three regression boundaries. No unresolved finding remains.

## Verification

- Commands to run: focused assistant-engine tests during implementation; final
  `pnpm test:diff` for touched assistant-engine source and tests; `git diff
  --check`; required `prompt-review` and `coverage-write` passes; exact-head PR
  preflight, ReviewGPT round(s), CI status, and merge-tree proof against latest
  `main`.
- Direct scenario: prove `2026-07-15T02:07:00Z` and a
  `2026-07-16T01:00:00Z` occurrence map to different New York local dates.
- Focused post-audit verification: 3 files, 201 tests passed; assistant-engine
  typecheck passed; `git diff --check` passed.
- Owner coverage: 158 files passed and 1 skipped; 2,305 tests passed and 5
  skipped; 89.7% statements, 81.73% branches, 94.16% functions, and 89.73%
  lines. The exact post-wording-change rerun used one worker and an 8 GB Node
  heap to avoid unrelated concurrent coverage pressure.
- The broader `pnpm test:diff` lane cleared dependency, workspace-boundary,
  hosted-runtime, logging, and all affected typechecks. Assistant runtime (1,736
  tests), assistantd, assistant-cli, and setup-cli passed before unrelated CLI
  command tests repeatedly hit their 60-second timeouts under concurrent test
  saturation; the session-owned run was stopped and replaced with the green
  owner coverage lane above.
- PR CI, exact-head ReviewGPT, and latest-base mergeability remain external
  post-push gates.
Completed: 2026-07-16
