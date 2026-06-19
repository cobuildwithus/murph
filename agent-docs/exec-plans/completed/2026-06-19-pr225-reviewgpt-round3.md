# PR 225 ReviewGPT Round 3

## Goal

Fix accepted ReviewGPT round 3 findings for PR 225:

- Local automation CLI active writes must not persist identity-less explicit email routes unless the hosted CLI bridge is present.
- Hosted queue-only cron execution must reject email thread-locator-only routes before model work.
- Email subject handling must use one selected-delivery thread predicate based on explicit-target precedence.

## Constraints

- Keep route validation as a small capability switch, not another parallel validator.
- Preserve pause/archive repair paths for invalid legacy records.
- Preserve local immediate email thread replies with an identity.
- Keep strict manual subject rejection for actual email thread replies.

## Files

- `packages/operator-config/src/assistant/current-delivery-route.ts`
- `packages/operator-config/test/assistant-current-delivery-route.test.ts`
- `packages/cli/src/commands/automation.ts`
- `packages/cli/test/automation.test.ts`
- `packages/assistant-engine/src/assistant/cron/targets.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/src/assistant/channels/helpers.ts`
- `packages/assistant-engine/src/assistant/channels/registry.ts`
- `packages/assistant-engine/src/assistant/channel-adapters.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- `packages/assistant-engine/test/email-subject.test.ts`

## Verification Plan

- Focused operator-config route test.
- Focused CLI automation tests.
- Focused assistant-engine cron/subject/outbox tests.
- Package typechecks for touched packages.
- `test:diff` for changed files.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
