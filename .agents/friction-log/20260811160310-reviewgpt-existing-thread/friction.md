---
title: 'ReviewGPT existing-thread attachment staging loses the target conversation'
severity: 'minor'
---

## Expected Behavior

An attached ReviewGPT follow-up that names an existing conversation should open that conversation, confirm the composer target, attach the exact review packet, and submit once.

## Current Behavior

The same existing-thread follow-up failed before submission on two isolated managed browser lanes. One lane found the composer and file input but could not match the requested conversation; the prompt-only fallback then landed on the new-chat page with no matching conversation. A fresh attached conversation succeeded with the same repository packet.

## Possible Solution

After navigation, require the active conversation identifier to match before probing the attachment input. Retry the target navigation once when the browser lands on the new-chat page, and report a distinct conversation-navigation error instead of an attachment-readiness error.

## Minimal Reproducible Example

1. Complete an attached review in a managed browser conversation.
2. Start a second attached review with that conversation URL on another signed-in managed lane.
3. Observe that staging can report a ready composer and file input while the requested conversation is not active.
4. Start the same request as a fresh attached conversation and observe successful submission.

## Context

The failure caused repeated full audit packaging and required a new implementation thread, while preserving the exact reviewed head and prompt.
