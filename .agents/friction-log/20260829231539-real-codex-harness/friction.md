---
title: 'Real-Codex harness login shell discards injected fixture PATH'
severity: 'minor'
---

## Expected Behavior

A focused real-Codex test that prepends a synthetic tool directory to `PATH` should run that fixture through model-issued shell commands.

## Current Behavior

The model uses `/bin/zsh -lc`. The login shell rebuilds `PATH` and selects the developer-wide `vault-cli` before the injected fixture. Tests then fail against an unrelated stale checkout.

## Possible Solution

The real-Codex harness should provide a private `ZDOTDIR` or another login-shell-safe fixture path contract. Individual journeys should not need to create `.zprofile`.

## Minimal Reproducible Example

Prepend a temporary directory containing `vault-cli` through the journey `env.PATH`. Ask the model to run `vault-cli`. Observe that `/bin/zsh -lc` selects the user-level executable instead.

## Context

This caused a synthetic Personal Patterns automation journey to execute a stale wrapper from another checkout before the test added a private `.zprofile` workaround.
