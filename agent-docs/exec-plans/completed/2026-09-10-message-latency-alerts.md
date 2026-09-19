# Per-message warm and cold typing latency alerts

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and protected invariants

Send one operational Resend email per slow inbound message: webhook receipt to
first accepted typing over 3 seconds for a retained warm workspace, over 10 seconds
for a cold workspace. Include rollout periods and all members. Email and diagnostic
work must stay off the reply path; preserve provider behavior and privacy.

## Owners and evidence

The existing ingress trace owns optional webhook receipt and early ingress typing
timestamps separately from mailbox acceptance. Runtime typing milestones retain
the earliest timestamp even when callbacks arrive out of order.
The runtime restore completion and cold flag classify each message against its own
receipt time, so later messages in an initially cold invocation are warm.
Reuse HostedLinqAlert and its Resend sender/recovery for durable per-message dedupe;
keep the existing aggregate full-reply incident monitor independent.

## Implementation and proof

1. Carry route receipt time through deferred ingress tracing for Linq and Telegram.
2. Preserve first typing acceptance and add the equivalent Telegram milestone.
3. Queue bounded per-message alerts from persisted traces after latency callbacks
   and in the existing cron; no rollout, quiet-hour, or singleton suppression.
4. Prove strict threshold boundaries, warm reuse after cold startup, delayed and
   missing typing, distinct messages, replay, provider failure, and metadata-only
   emails. Run focused tests and affected typechecks, then review and commit.

## Failure and deployment

Apply the additive nullable trace migration before Web. Deploy the compatible Web
reader before the Telegram milestone producer, then roll the runtime containers
for active-typing inheritance and Telegram acceptance evidence. Existing Linq
runners retain their current telemetry protocol. Older Telegram runners can lack
acceptance evidence during mixed deployment and produce missing-evidence alerts;
there is deliberately no version suppression. Reverting the new reader requires
first stopping the new Telegram milestone producer. No rollback was performed.
Missing old receipt stamps cannot be represented as webhook-to-typing measurements.
Existing alert recovery owns failed sends.
No production secrets or private message content enter the new evidence.

## Product and completion

Internal operational alerts only; no assistant prompt, tool, reply, or delivery
policy change and no public changelog item. Local implementation and verification
are authorized; deployment remains separately reported.

## Review and operating limits

Parent candidate review: complete. The changed telemetry adds no awaited database
or provider operation before typing or webhook acknowledgment. Existing typing
start, refresh, stop, and cooldown behavior is preserved. No assistant prompt,
model input, or tool policy changed; a live model journey is not applicable.

Each evaluation reads at most 1,001 candidates, inserts at most 1,000 alerts, and
attempts 50 sends sequentially through the existing sender. The maximum is 103
database statements and 50 HTTP sends, with no external work inside a database
transaction. Existing recovery drains the rest. Alert retention outlives the
seven-day trace scan, preserves unsent work, and cannot regenerate old alerts.

Warmth unavailable in telemetry is explicitly unconfirmed and uses 10 seconds.
Missing typing is evaluated after a 30-second telemetry allowance by the existing
five-minute cron. Completed measurements use actual acceptance time and strict
3-second/10-second boundaries. Diagnostic persistence remains best effort.

Local implementation and review are complete. Production migration, deployment,
real email delivery, CI, and external PR review were not performed. There is no
open PR; this task ends at the normal scoped local commit authorized by the
change request. Activation requires the separately authorized hosted release path.

## Verification

- Initial focused Web tests: 143 passed, including real PostgreSQL threshold,
  burst, deduplication, and mocked Resend retry proof.
- Web ingress route, wake, and dispatch tests: 248 passed.
- Runtime channel activity and shared protocol tests: 64 passed.
- Web, hosted-execution, and assistant-runtime typechecks passed.
- Final PostgreSQL, retention, and sender suite: 20 passed. SQL proof used
  `MURPH_TEST_POSTGRES_CONCURRENCY=1` with an isolated local PostgreSQL connection
  and temporary tables; all Resend HTTP responses were mocked.
- Runtime channel and workspace entrypoint suite: 45 passed; the actual mailbox
  conversation import suite: 70 passed, including messages joining active typing.
- Final callback route and webhook wake suite: 112 passed, proving both channels
  evaluate after persistence/response with the authenticated member and exact input.
- Final Web and assistant-runtime typechecks passed after implementation updates.
- `pnpm build:workspace:incremental`, `pnpm complexity:diff`, selected Web ESLint,
  `pnpm docs:drift`, and `git diff --check` passed.
- Complexity review: no new or enlarged function above 20. Existing webhook,
  dashboard, importer, parser, and timing-inspector hotspots retain their debt;
  unrelated refactors would expand scope without improving the alert contract.
- The user confirmed both warm and cold timing is webhook receipt to typing.
- No new repository-actionable Frog friction was introduced.
Completed: 2026-09-10
