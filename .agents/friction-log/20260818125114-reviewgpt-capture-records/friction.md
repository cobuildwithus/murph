---
title: 'ReviewGPT capture records a coverage artifact without a downloadable attachment'
severity: 'minor'
---

## Expected Behavior

When a marked specialist response declares `Patch artifact: reviewgpt-coverage.patch`, capture metadata should bind the assistant-owned attachment and `thread download --artifact-index 0` should retrieve that exact file from the recorded review thread.

## Current Behavior

The capture records artifact index 0 with a content hash but a null href. The canonical thread-download command then fails because the assistant turn exposes no attachment button, even though the substantive response declares the patch artifact.

## Possible Solution

Fail the specialist capture when a declared patch has no downloadable attachment, or persist an artifact handle that the downloader can resolve without depending on a visible thread button.

## Minimal Reproducible Example

1. Run the preliminary specialist review and let it return a marked `FINDINGS` response declaring `reviewgpt-coverage.patch`.
2. Confirm the capture metadata lists artifact index 0 but no href.
3. Run `cobuild-review-gpt thread download` for index 0 against the recorded thread and managed browser endpoint.
4. Observe that download fails because no artifact button is available.

## Context

This blocks the repository-required inspect-and-apply flow for a bounded test-only coverage patch and forces the parent to reconstruct the test change manually from the written finding.
