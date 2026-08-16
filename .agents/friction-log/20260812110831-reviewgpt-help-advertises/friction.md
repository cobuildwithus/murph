---
title: 'ReviewGPT help advertises a rejected no-artifacts flag'
severity: 'minor'
issue: 'cobuildwithus/murph#1860'
---

## Expected Behavior

`pnpm review:gpt --help` and the command parser should agree on the flag for resuming an existing thread without attaching another repository package.

## Current Behavior

The installed help lists `--no-artifacts`, but a follow-up invocation fails immediately with `Unknown flag: --no-artifacts`. The same invocation proceeds when `--no-zip` is used instead.

## Possible Solution

Either accept `--no-artifacts` as the documented alias or remove it from generated help and document `--no-zip` consistently. Add a CLI regression that runs the printed flag through argument parsing.

## Minimal Reproducible Example

1. Run `pnpm review:gpt --help` and observe `--no-artifacts`.
2. Run `pnpm review:gpt --chat <existing-thread-url> --no-artifacts --wait --prompt "Continue."`.
3. Observe `Unknown flag: --no-artifacts` before browser launch.
4. Replace `--no-artifacts` with `--no-zip`; argument parsing succeeds.

## Context

This blocks the documented safe path for resuming an owned ReviewGPT thread after incomplete response capture and can encourage accidental duplicate attachments or reviews.
