---
title: 'Inactive runner drain guard hides pagination rejection reason'
severity: 'minor'
---

## Expected Behavior

A protected deployment that rejects pagination evidence should report the failed invariant without exposing opaque provider cursors or resource identity.

## Current Behavior

Non-string, whitespace-only, oversized, and repeated next-page tokens all produce the same unavailable-state error. The operator cannot distinguish malformed evidence from cursor cycles or a local size limit.

## Possible Solution

Report fixed rejection categories with page count, native-row count, and oversized token length. Preserve every drain acceptance condition and inspection bound. Larger bounded pages can reduce exposure to provider cursor cycles, but a repeated cursor must still stop admission.

## Minimal Reproducible Example

Mock a successful stopped-instance response with next_page_token set to a number, whitespace, a string longer than 2048 characters, or a previously returned cursor. Assert that each rejection identifies its invariant without printing the cursor.

## Context

The diagnostic gap prevents a deployment operator from selecting an evidence-based next step after a guarded rollout stops.
