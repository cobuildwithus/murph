---
title: 'Mailbox dirty-ack coverage cases failed once during full-suite verification'
severity: 'minor'
---

## Expected Behavior

The assistant-runtime coverage suite should reliably prove that successful dirty acknowledgments preserve their follow-up wake after snapshot projection and browser publication.

## Current Behavior

One full coverage run failed two variants of `system mailbox mode preserves successful dirty-ack follow-up wake`: without a foreground handoff and with assistant work already due. The fixture reported `HOSTED_VAULT_SHARE_PROJECTION_FAILED`, so the expected acknowledgment was not reached. Other package suites were running concurrently. Concurrency is context, not a proven cause.

The unchanged five-variant focused rerun passed, followed by an unchanged full coverage rerun with 3,895 passing tests and seven skips. No production regression or deterministic fixture defect has been established.

## Possible Solution

If this recurs, capture bounded projection-worker failure metadata in the test assertion to distinguish snapshot restoration, worker startup, projection capture, and cancellation. Preserve the acknowledgment, projection, publication, and wake assertions; do not expand production time budgets or suppress the error.

## Minimal Reproducible Example

The observed command was `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test:coverage` while other requested full suites were running. It produced two failures once and passed unchanged on a later full run. This report records an intermittent observation, not a deterministic reproduction.

## Context

Full-suite verification of a transport-deletion branch discovered the transient failure. The projection and system-mailbox production owners are unchanged from that branch's base. Existing checkpoint-wake timer friction concerns a different fixture.
