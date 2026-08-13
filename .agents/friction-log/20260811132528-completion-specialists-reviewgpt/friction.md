---
title: 'Completion-specialists ReviewGPT prompt exceeds the ChatGPT composer limit'
severity: 'minor'
---

The canonical `pnpm review:gpt completion-specialists --wait` command should submit the repository-required specialist prompt when the PR body satisfies every completion-workflow section.

## Current Behavior

The guarded specialist preset plus a complete required PR body produced a 26,889-character composer. ChatGPT accepted the ZIP but disabled `Send prompt` without an alert. ReviewGPT waited through its staging retries and failed before submission on multiple managed lanes. The slightly smaller final-review prompt remained sendable.

## Possible Solution

Have the packager enforce a preflight composer-size budget, compact repeated intent text, or move the long lens instructions into the attached snapshot so a valid required PR body cannot make the draft unsendable.

## Minimal Reproducible Example

1. Open a sensitive PR whose body includes the required intent, UX, invariants, lenses, architecture, hot-path, provider-input, change-shape, rollout, and verification sections.
2. Run `pnpm review:gpt completion-specialists --wait` on its clean pushed head.
3. Observe the ZIP attach successfully and the composer reach roughly 27,000 characters.
4. Observe `Send prompt` remain disabled until the staging command fails.

## Context

This blocks the mandatory preliminary gate even though the PR head, attachment, model selection, authentication, and browser endpoint all pass preflight. Manually shortening the still-valid PR body is the only available workaround.
