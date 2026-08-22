---
title: 'ReviewGPT loses the accepted thread URL after confirmed auto-send'
severity: 'minor'
---

## Expected Behavior

After confirming an attachment and auto-submitting a waited review, ReviewGPT should capture the exact accepted conversation URL and continue waiting on that thread.

## Current Behavior

The wrapper confirmed the attachment and reported that auto-send committed, but then failed because it could not prove one exact accepted conversation URL. The review was already running, so retrying the send would risk a duplicate. Recovery required enumerating the exact managed-browser endpoint, identifying the newly accepted conversation, and waking that thread explicitly.

## Possible Solution

Bind the post-submit URL capture to the exact created or navigated tab and preserve that receipt before reporting send success. If URL capture races navigation, poll only that owned tab until it has one conversation URL instead of failing after the prompt has been accepted.

## Minimal Reproducible Example

1. Start a waited ReviewGPT run with one confirmed audit attachment.
2. Let auto-send commit while ChatGPT changes from the new-chat URL to the accepted conversation URL.
3. Observe the wrapper report that send committed but exit because it cannot prove the accepted URL.

## Context

Both concurrent required review lanes hit this state on the same candidate. The submitted conversations continued normally and were recovered without resending by using their original managed-browser endpoints.
