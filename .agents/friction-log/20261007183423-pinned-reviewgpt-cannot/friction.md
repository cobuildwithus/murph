---
title: 'Pinned ReviewGPT cannot traverse the current GPT-6 model picker'
severity: 'minor'
issue: 'cobuildwithus/murph#4085'
---

## Expected Behavior

The canonical PR review command selects GPT-6 Pro and submits the guarded exact-head snapshot after proving the selected model.

## Current Behavior

The pinned ReviewGPT 0.5.152 selector recognizes the older Latest family row but does not traverse the current GPT-6 row. It stops before sending when the menu exposes GPT-6 and Power separately. The generic Pro label cannot independently establish the requested concrete model.

## Possible Solution

Consume published ReviewGPT 0.5.153, which recognizes the current family row and combines picker and sent-request evidence. Preserve Murph's existing capture, minimum-duration, and wake patches.

## Minimal Reproducible Example

Run the canonical PR review command with the pinned 0.5.152 package on a managed profile that exposes the GPT-6 family row and Power control. Selection stops before submission. No model downgrade or current-selection bypass is an equivalent fix.

## Context

This prevents final PR review even when the candidate, attachment, and browser authentication are valid.
