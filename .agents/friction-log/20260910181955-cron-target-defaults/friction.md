---
title: 'Cron target defaults discard explicit audience directness'
severity: 'minor'
---

## Expected Behavior

The cron target defaults helper should preserve an explicitly supplied threadIsDirect value when resolving an already complete channel and thread route.

## Current Behavior

In packages/assistant-engine/src/assistant/cron/targets.ts, resolveAssistantCronTargetDefaults omits input.threadIsDirect from the object passed to applyAssistantSelfDeliveryTargetDefaults. It then overwrites the original field with resolvedRoute.threadIsDirect, which is undefined without another saved default. Calling setAssistantCronJobTarget with a direct synthetic Telegram route can therefore erase audience evidence and cause notification execution to reject the route as unverified. The target mutation API also intentionally preserves existing session continuity; supplying sessionId is not a way to set the execution model for a canonical automation.

## Minimal Reproducible Example

In an isolated test with no saved delivery defaults, resolve a target containing channel telegram, threadId synthetic-thread, and threadIsDirect true. Compare the returned directness with the supplied boolean. Then inspect the canonical route produced by setAssistantCronJobTarget with those fields.

## Context

Discovered while composing a real-model reminder journey. The journey now preserves the model-created route and supplies the scheduler model through the existing execution-context default target. No production runtime behavior was changed to make the test pass.
