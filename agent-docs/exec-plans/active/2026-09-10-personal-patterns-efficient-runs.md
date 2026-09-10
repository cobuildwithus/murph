# Reduce unchanged Personal Patterns model runs

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and owners

Use Luna high for Personal Patterns and skip scheduled model entry when canonical
report and notification history prove no new factor, graded identity, or grade
needs review. Preserve first digests, muted results, alias migration, failed-attempt
retries, one-message delivery, and Flex-first processing.

The query package already calculates the report. The assistant's existing Knowledge
ledger owns notification history, while cron owns execution. Its current free-form
body cannot safely authorize deterministic suppression. Reuse that same page with
a versioned JSON body; missing, legacy, degraded, or invalid history keeps the model.
No new cache, scheduler, service, or state store.

## Product UX

Effort: Product change.
Outcome: unchanged days avoid AI usage; new findings still receive model review.
Reaches: established members, first digests, legacy ledgers, aliases/mutes, new
factors/results, grade changes, manual invocations, and failed attempts.
Proof: canonical Knowledge readback, pure comparison, composed cron zero-provider
and next-occurrence proof, and a focused Luna high live digest with ledger readback.
Done when these journeys are Ready and required PR checks and review pass.

## Execution

1. Add conservative eligibility, structured-ledger instructions, and Luna high.
2. Prove suppression and preserve meaningful changes, retries, and ordinary calls.
3. Run focused tests/typecheck, the live journey, and complexity/candidate review.
4. Update product/architecture owners and the public changelog.
5. Open a draft PR, mark Ready after local proof, run ReviewGPT alongside CI.

## Failure and deployment

This is a runtime-only release with no Web or database migration. Existing pages
enter the model until safely converted. Unrepresentable legacy preferences retain
their existing format and normal review. Read failures never mean unchanged, and
cancellation propagates. Explicit manual runs and failed retries bypass suppression.
Older runners can read JSON as ordinary Knowledge text and keep their daily behavior.
Deployment and measured production savings are outside this PR's local proof.

## Verification

- Focused eligibility, managed-automation, and cron suites: 304 tests passed.
- Scheduler regression fails against the unchanged base implementation because it
  enters the model; the candidate skips and advances the schedule. A changed next
  occurrence uses Luna high/Flex; manual runs and Standard failure retries remain.
- Assistant Engine typecheck passed. Complexity guard passed with no added debt;
  the new eligibility helper stays below 20 and existing hotspots are unchanged.
- Changelog rendering: 10 tests passed; Web typecheck is pending.
- The live Luna high digest is pending; the default local subscription returned
  unauthorized before any provider action, so the bounded alternate-home retry is
  in progress. No production credential or member data is used.
- Parent candidate review found no new state owner, notification write in the
  precondition, foreground call, or migration requirement. Direct proof remains
  pending the live journey. Exact-head CI and final ReviewGPT follow the draft PR.
