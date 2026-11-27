---
title: 'ReviewGPT loses waited capture when it misses a submitted attachment'
severity: 'minor'
---

## Expected Behavior

A waited architecture review should capture the response after the plan and repository ZIP reach the review thread.

## Current Behavior

The runner confirms the staged ZIP, then treats the submitted turn as missing the attachment. The same browser tab shows the plan, the ZIP and an active review using the snapshot. The runner exits before writing the requested response file.

## Minimal Reproducible Example

Submit a synthetic plan with the architecture preset, a repository snapshot and a completion marker. When the submitted-turn check fails, inspect that tab for the attachment and the active response.

## Context

Recovering the existing response requires identifying the exact tab and confirming the prompt, attachment and marker there.
