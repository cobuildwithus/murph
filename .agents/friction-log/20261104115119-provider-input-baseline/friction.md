---
title: 'Provider input baseline reuses candidate model behavior'
severity: 'minor'
issue: 'cobuildwithus/murph#4550'
---

## Expected Behavior

Complete provider input measurement against a Git base should include the base revision of model behavior when that prompt owner changes.

## Current Behavior

The measurement copies the base system-prompt module but imports model-behavior from the working tree. A change only in model-behavior therefore appears in both captures and produces a false zero delta.

## Possible Solution

Materialize the base model-behavior module alongside the base prompt and redirect its import, following the existing game-tool baseline pattern.

## Minimal Reproducible Example

Change a direct progress instruction in model-behavior.ts and run the opt-in assistant-game-input-measurement test against HEAD. Without the baseline dependency fix, both direct captures contain the changed instruction.

## Context

Prompt wording changes need complete provider input deltas; authored-text counts alone do not satisfy that boundary.
