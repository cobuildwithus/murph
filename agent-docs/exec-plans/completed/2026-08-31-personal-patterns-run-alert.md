# Personal Patterns Run Alert

## Outcome

Operators receive one privacy-safe email when the managed Personal Patterns
run fails or when its scheduled occurrence expires before execution.

## Scope

- Add stable Personal Patterns identity and occurrence time to existing cron
  runtime events.
- Reuse the existing hosted operational email configuration and Resend sender.
- Keep alert delivery best-effort so it cannot block runtime-log persistence.
- Add focused tests for failure, expiry, idempotency, and unrelated log events.
- Update the Personal Patterns product contract with the exact alert boundary.

## Product UX

Internal-only operational change. Members receive no new message and no
product behavior changes.

## Proof

- Assistant cron tests prove the exact managed automation metadata.
- Hosted runtime tests prove the metadata survives redaction.
- Hosted Web tests prove one email per failed or expired occurrence.
- Package typechecks prove the cross-package event contract remains valid.

## Deliberate Limit

This alert detects a failed run and a late occurrence that the runtime marks as
expired. A complete platform outage needs an external uptime monitor because
the hosted runtime cannot report while it is offline.

## Verification

- Assistant engine focused tests: 210 passed.
- Assistant runtime focused tests: 97 passed.
- Hosted Web focused tests: 72 passed.
- Assistant engine, assistant runtime, and Hosted Web typechecks passed.
- `git diff --check` passed.

## Review

The local cross-cutting review found two proportionality questions. The alert
keeps best-effort delivery because adding durable retry state would add a new
operational system for one internal alert. A stable provider idempotency key
prevents duplicate mail, and one failed delivery no longer stops later alerts
in the same batch. The email keeps the opaque member ID because operators need
it to find the matching private runtime log. It includes no health data or raw
error text.
Status: completed
Updated: 2026-08-31
Completed: 2026-08-31
