---
title: 'ReviewGPT can stage a ready draft while the send control stays disabled'
severity: 'minor'
---

## Expected Behavior

ReviewGPT should wait for a stable usable composer and submit once its prompt and attachment are confirmed ready.

## Current Behavior

The managed ChatGPT page can exceed the fixed composer-readiness window during hydration. A retry can then populate the full prompt and confirm the attachment while the send control remains disabled, producing another pre-send failure with no actionable state beyond a generic disabled-button result.

## Possible Solution

Wait on the actual sendable state after prompt and attachment staging, with a bounded timeout and structural diagnostics that distinguish hydration, upload, validation, and account-state blockers.

## Minimal Reproducible Example

1. Open a fresh managed browser lane and start a waited ReviewGPT pass with one audit attachment.
2. Let the page hydrate beyond the initial fixed readiness window, then retry on the warmed lane.
3. Observe the prompt and attachment reach ready state while submission still fails because the send control is disabled.

## Context

This repeatedly blocked repository-required reviews before any model request was sent and forced lane retries without changing the candidate patch.
