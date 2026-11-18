---
title: 'Cold native runner builds exhaust the Web and recap smoke job budgets'
severity: 'minor'
---

## Expected Behavior

A runner version upgrade can complete the browser and video checks before the protected publisher has uploaded the new image.

## Current Behavior

Both jobs spend their 30-minute budget compiling native Codex on a registry miss. GitHub cancels the build before the browser or video assertions run.

## Minimal Reproducible Example

Change the native Codex source pin, leave its fingerprint unpublished, and run the two image-dependent pull request checks on fresh hosted runners.

## Context

The previous native PR builder took over an hour to prepare the base. Separating preparation from smoke execution gives each step its own deadline.
