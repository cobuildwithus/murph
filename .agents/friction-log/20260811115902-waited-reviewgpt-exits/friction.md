---
title: 'Waited ReviewGPT exits after an accepted long-running response detaches from capture'
severity: 'minor'
---

## Expected Behavior

A waited ReviewGPT run that successfully submits its prompt should remain attached until the configured response timeout, or automatically resume capture from the exact accepted thread.

## Current Behavior

A long-running review can continue in the managed ChatGPT thread while the local ReviewGPT command exits with a response-capture failure. Recovery then requires exporting the retained thread, confirming it is still composing, and starting a separate same-thread watcher without resending the audit.

## Possible Solution

When submission is confirmed, retain the selected browser endpoint and thread identifier as capture state, then fall through to the existing same-thread polling logic before reporting failure.

## Minimal Reproducible Example

1. Start an attached ReviewGPT audit with `--send --wait` and a response timeout longer than the expected review.
2. Let the accepted review continue through a long reasoning phase.
3. Observe the local command exit from response capture while the same managed thread remains busy.
4. Export that exact thread and observe that it is still composing or has since completed.

## Context

This interrupted a required PR review gate after the expensive audit had already been accepted. The manual recovery had to preserve the original thread to avoid duplicate review work.
