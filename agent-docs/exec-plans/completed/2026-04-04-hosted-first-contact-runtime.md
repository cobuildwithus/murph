# Hosted First-Contact Runtime

## Goal

Refactor hosted onboarding so the first Murph welcome is sent by the hosted assistant runtime as a real assistant-originated turn during `member.activated`, while keeping the overall activation architecture simpler, privacy-preserving, and retry-safe.

## Why

- The current web-side Linq welcome bypasses assistant transcript/session state, so the next user reply does not reliably include the welcome in context.
- Prompting the model proactively would require a synthetic user prompt in the current assistant stack, which is semantically wrong and adds privacy noise.
- The clean boundary is `apps/web` owns billing truth and activation dispatch, while hosted runtime owns assistant messaging.

## Constraints

- Keep Stripe webhook inline activation and `execution_outbox` as the only durable happy-path async boundary.
- Keep RevNet code present but out of the launch happy path when disabled.
- Do not introduce a fake user turn or a model-generated first message.
- Keep delivery routing metadata minimal and move any newly sensitive hosted activation payloads behind encrypted payload references.
- Preserve overlapping dirty-tree edits outside the exact hosted first-contact scope.

## Intended Changes

1. Remove the web-side activation welcome send and related queueing/recovery plumbing from hosted onboarding.
2. Extend `member.activated` with the minimal Linq conversation locator needed for a proactive assistant first-contact turn.
3. Store that richer hosted activation payload through the encrypted reference payload path instead of inline payload storage.
4. Add a small assistant-core proactive-send helper that persists a deterministic assistant welcome turn without invoking the model or inventing a synthetic user message.
5. Have hosted runtime call that helper during `member.activated` after bootstrap when a Linq signup thread exists and first-contact has not been seen.
6. Share the canonical welcome copy between the proactive helper and the first-turn prompt guidance so the wording has one owner.

## Verification Target

- Required repo/app checks for touched packages and apps.
- Focused tests proving `invoice.paid` activation still works, the hosted runtime sends the first-contact welcome once, and the next-turn context path now sees the real assistant turn.
- Direct scenario proof for `member.activated` with a bound Linq signup thread leading to one deterministic hosted assistant send.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
