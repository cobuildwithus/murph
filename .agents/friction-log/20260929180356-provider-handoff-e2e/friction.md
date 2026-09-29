---
title: 'Hosted provider E2E fixtures expect retired default models'
severity: 'minor'
---

## Expected Behavior

Hosted E2E scenarios should verify the canonical model selected by Web. A
provider-only switch to Venice with no explicit model uses GPT-5.6 Sol; the
ordinary OpenAI default used by scheduled reminders is GPT-6 Sol.

## Current Behavior

The provider-handoff and Telegram scheduled-reminder scenarios both expect
GPT-5.6 Terra. The canonical configuration owner and its deterministic tests
select the current Sol defaults. Valid provider requests therefore fail the
exact-model assertions and block release integration.

## Minimal Reproducible Example

Run `pnpm hosted-local e2e warm-reuse-egress` with the existing synthetic provider
fixture. After saving Venice without a model preference, the recorder observes
`gpt-5.6-sol`; the E2E expects `gpt-5.6-terra`.

Run `pnpm hosted-local e2e telegram-scheduled-reminder` with the existing
synthetic reminder fixture. Scheduled OpenAI requests use `gpt-6-sol`; the
recorder predicate expects `gpt-5.6-terra` despite successful reminder delivery.

## Possible Solution

Update the expected canonical models and the reminder's stub configuration.
Retain provider-update, wake, request-count, fresh-invocation, Responses Lite,
cache-compatibility, due-time, and delivery checks.

## Context

These test-only mismatches prevent the protected worker release from completing.
No production model selection or provider behavior needs to change.
