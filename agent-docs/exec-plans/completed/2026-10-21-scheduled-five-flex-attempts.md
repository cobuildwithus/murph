# Allow five Flex attempts before scheduled Standard fallback

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal and ownership

Managed scheduled updates with the existing six-hour recovery window use Flex
for their first five attempts and Standard from attempt six. Reuse canonical
consecutive-failure state and the existing extended-window eligibility predicate;
add no counter, timer, schema, queue, provider loop or delivery owner.

## Product UX

- Outcome: Permit transient capacity recovery on Flex before paid-tier fallback.
- Reaches: The five managed update identities with recurring schedules eligible
  for extended recovery. Ordinary reminders retain first-retry Standard fallback;
  private maintenance retains Flex. Shorter managed schedules use the ordinary policy.
- Proof: Real cron execution with synthetic provider failures through attempts
  five, six and seven; recovery delivery or intentional silence, no duplicate
  scan execution, next-occurrence reset, and existing expiry boundaries.

## Timing and constraints

Existing failure backoff is 30 seconds, one minute, five minutes, fifteen minutes,
then one hour. With instantaneous failures and timely scanning, attempt six is
eligible after 81.5 minutes; provider duration and scheduling can add delay.
Freshness, active-until, next occurrence, consent and routing continue to bound
eligibility. Ordinary one-hour reminders must not inherit a threshold whose
first Standard retry would already be expired. Existing capacity error fixes
remain intact. Production is not mutated by this task.

## Tasks

1. Reuse extended-window eligibility in service-tier selection with a five-attempt limit.
2. Replay Flex recovery, Standard fallback and continued Standard retries through
   the real cron state owner; preserve maintenance and ordinary reminders.
3. Update the architecture owner and PR intent, run focused tests, typecheck and
   complexity verification, then commit, push, review and await exact-head CI.

## Verification

- Focused assistant tests: 374 passed across cron runtime, provider failure and
  automation support suites. Coverage includes all five managed identities,
  success on attempt five, Standard attempts six and seven, delayed recovery,
  sent versus silent outcomes, duplicate scans and next-occurrence reset.
- Ordinary reminders and managed hourly/one-shot schedules retain first-retry
  Standard. Private maintenance remains Flex beyond five prior failures.
- Assistant-engine typecheck and complexity diff passed; existing complexity
  debt is unchanged. Parent diff and privacy review passed.
- Product UX: Ready at the deterministic runtime boundary. Provider capacity and
  actual delivery remain post-deploy observations. No real-model journey is
  needed because prompts, tools and decision policy are unchanged.
- Initial test fixture syntax, cron field and schedule-anchor mistakes were
  corrected before the passing run; no production behavior was changed for them.
- ReviewGPT round two and exact-head CI follow the pushed candidate; the PR
  evidence owns their final status. Existing changelog content remains accurate.
Completed: 2026-10-21
