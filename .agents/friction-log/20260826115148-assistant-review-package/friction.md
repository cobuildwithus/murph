---
title: 'Assistant review package omits required verification skill'
severity: 'minor'
issue: 'cobuildwithus/murph#2390'
---

## Expected Behavior

The preliminary assistant-behavior review package includes the repository guidance that AGENTS.md makes mandatory for the changed surface.

## Current Behavior

The exact-head `completion-specialists` archive omits the `.agents/skills` tree, so ReviewGPT returns `INVALID` even though the required verification skill exists and governed the local work.

## Possible Solution

Add the assistant verification skill to the preliminary review always-path policy when prompt or assistant-behavior lenses apply.

## Minimal Reproducible Example

1. Open a prompt-primary assistant pull request.
2. Run the `completion-specialists` ReviewGPT preset.
3. Inspect `codebase.zip` and observe that the required assistant verification skill is absent.

## Context

The reviewer cannot validate the assistant-specific proof contract until the caller manually adds the missing skill path to the audit-context allowlist.
