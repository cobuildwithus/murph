# Personal Patterns terminal alerts

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Send an operator email only when Personal Patterns automatic recovery ends.
- Coalesce concurrent member failures for one scheduled occurrence into one
  provider-idempotent email.

## Success criteria

- Retryable failures do not send email.
- Terminal failures and expired occurrences send one generic alert per
  scheduled occurrence.
- Member identity and individual failure details stay out of the alert body.
- The retry disposition survives the assistant-engine to hosted-log boundary.
- Focused tests, typechecks, complexity, docs drift, PR review, and CI pass.

## Scope

- In scope: cron completion diagnostics, hosted log persistence, Web alert
  selection, provider idempotency, focused tests, and durable contracts.
- Out of scope: a new queue, database alert state, schedule staggering, cron
  ownership changes, and manual Cloudflare deploy or rollback.

## Constraints

- Technical constraints: use finalized cron state and the existing Resend
  idempotency boundary. Keep Web compatible with an older runtime.
- Product/process constraints: preserve automatic recovery and keep operator
  email useful without exposing member identifiers.

## Risks and mitigations

1. Risk: Web sees a failure from an older runtime without retry disposition.
   Mitigation: treat a missing disposition as non-terminal.
2. Risk: many members fail concurrently for one occurrence.
   Mitigation: use the same generic payload and member-independent provider key.
3. Risk: Web and Cloudflare deploy out of order.
   Mitigation: deploy Web first, then Cloudflare, and verify the next occurrence.

## Tasks

1. Derive retry state after the cron owner finalizes the job.
2. Persist the retry state through hosted runtime logging.
3. Filter retryable failures and coalesce terminal alerts in Web.
4. Add focused tests and update the reliability protocol.
5. Run verification, review the candidate, and complete the PR lane.

## Decisions

- Use provider idempotency instead of adding another database or queue owner.
- Keep expired occurrences alertable because no later retry result can recover
  the missed occurrence.
- Do not include member-specific data in a globally coalesced email.

## Verification

- Commands to run: focused Vitest suites for assistant-engine,
  assistant-runtime, and Web; package and Web typechecks; focused Web ESLint;
  `pnpm complexity:diff`; `pnpm docs:drift`; final ReviewGPT and required CI.
- Expected outcomes: all checks pass, retryable failures stay silent, terminal
  events produce one stable payload and key per occurrence.
Completed: 2026-09-02
