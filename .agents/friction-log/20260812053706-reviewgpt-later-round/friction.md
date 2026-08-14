---
title: 'ReviewGPT later round lane cannot access bound thread'
severity: 'minor'
issue: 'cobuildwithus/murph#1754'
---

## Expected Behavior

Later ReviewGPT rounds that require an existing conversation should select a
managed browser lane that can resolve that exact thread before packaging and
staging the review.

## Current Behavior

Automatic lane selection can choose a lane authenticated to another ChatGPT
workspace. ChatGPT redirects the required thread URL to the home page, and the
staging guard eventually reports an attachment target mismatch. The message
does not reveal that the selected lane cannot access the conversation.

## Possible Solution

Probe the required thread URL across usable lanes before a later-round run,
pin a lane that preserves the exact conversation URL, and fail with a
thread-access error when none can resolve it.

## Minimal Reproducible Example

1. Start a first ReviewGPT round in one managed browser workspace.
2. Run a later round with its required thread URL and automatic lane selection.
3. Let the wrapper select a lane authenticated to a different workspace.
4. Observe the URL redirect to the ChatGPT home page followed by an attachment
   target mismatch instead of a thread-access diagnostic.

## Context

This delayed a required data-integrity review and required read-only CDP probes
across lanes to identify the workspace that owned the immutable review thread.
