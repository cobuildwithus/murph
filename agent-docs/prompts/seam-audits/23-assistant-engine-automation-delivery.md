---
description: One-pass seam audit prompt for assistant-engine automations, cron, outbox, and delivery
---

# `@murphai/assistant-engine` Automations, Cron, Outbox, And Delivery

## Scope

- `packages/assistant-engine/src/{assistant-automation.ts,assistant-cron.ts,assistant-outbox.ts}`
- `packages/assistant-engine/src/assistant/automation/{run-loop.ts,scanner.ts,reply.ts,grouping.ts,shared.ts,runtime-lock.ts,prompt-builder.ts}`
- `packages/assistant-engine/src/assistant/{outbox.ts,delivery-service.ts,first-contact.ts,first-contact-welcome.ts,notification-turn.ts,food-auto-log-hooks.ts,active-experiment-context.ts,auto-reply-channels.ts}`
- `packages/assistant-engine/src/assistant/outbox/{store.ts,dispatch-state.ts,retry-policy.ts,intents.ts,summary.ts}`
- `packages/assistant-engine/src/assistant/cron/{store.ts,locking.ts,runtime-state.ts,notification-delivery.ts,schedule.ts,presets.ts}`
- directly coupled `packages/assistant-engine/test/**`

## Focus

- cron claim/run/finalize behavior, outbox replay safety, and delivery idempotency
- automation/runtime-state vs canonical-memory or automation-doc boundaries
- first-contact and notification paths that could send, schedule, or preserve the wrong thing
- scan cursors and audience binding that must remain monotonic and scoped correctly

## Prompt

Review the automation, cron, outbox, and delivery seam in `@murphai/assistant-engine` using the scope above. Focus on concrete bugs in due-job claiming and finalization, outbox replay/idempotency, auto-reply or first-contact behavior, and any place runtime residue starts acting like canonical user-facing state. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that separate scheduling, delivery, and canonical automation ownership more cleanly. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
