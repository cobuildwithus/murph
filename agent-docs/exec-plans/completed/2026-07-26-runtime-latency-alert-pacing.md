# Hosted runtime latency alert pacing

## Problem

The hosted reply-latency monitor sends only once during one uninterrupted
incident, but its five-minute cron can start a new incident immediately after a
brief healthy scan. Failed or uncertain sends can also be reconsidered on the
next scan. The alert therefore lacks a durable operator-time quiet-hours gate
and a hard minimum interval between provider attempts.

## Change

- Require an operator IANA timezone before enabling the latency-alert channel.
- Suppress alert sends from 11 PM through 7 AM in that timezone, with a stable
  per-day wake-up jitter after quiet hours.
- Enforce at least ten minutes plus stable jitter of up to ten minutes between provider
  attempts, including retries and incidents separated by a healthy scan.
- Clear any sending or failed incident when the underlying latency evidence is
  healthy so deferred stale copy cannot page after recovery.
- Keep exact message bodies and idempotency keys for ambiguous retries, while
  separate incidents retain factual checked-at timestamps.
- Document the deployment configuration and pacing contract.

## Invariants

- Detection and observability continue overnight; only outbound paging is
  suppressed.
- One uninterrupted anomaly produces at most one accepted alert.
- Ambiguous retries reuse the exact payload and idempotency key.
- Missing or invalid operator-time configuration fails closed for outbound
  alerts without weakening the latency monitor itself.
- No user-facing messaging, onboarding, authentication, or hosted reply path is
  disabled or delayed.

## Verification

- Focused latency-alert monitor and cron tests.
- Hosted local alert scenario when the harness can run.
- Canonical diff verification and acceptance verification.
- Required product-experience review, completion-specialist review, final
  ReviewGPT gate, and pull-request CI.

## Outcome

The monitor now requires complete destination/timezone configuration, applies
operator-local quiet hours and stable multi-cron-bucket jitter, preserves a
hard ten-minute provider-attempt floor across retries and recurrences, and
clears recovered failed or in-flight incidents instead of paging stale copy.
Ambiguous retries remain exact and provider-idempotent while distinct incidents
retain factual checked-at variation.

Focused monitor/cron tests and both affected app typechecks passed. The
product-experience review found three delivery/recovery gaps; all were remediated
and its follow-up review returned no findings. The canonical diff verifier
passed its pre-app policy, boundary, orchestration, crypto, and logging guards,
but its affected-web phase could not acquire the shared host slot because an
unrelated verifier retained it. Full composed verification therefore remains a
pull-request CI requirement.
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
