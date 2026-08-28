---
title: 'Focused live CLI fixtures depended on ambient runner state'
severity: 'minor'
---

## Expected Behavior

A production-derived live assistant journey should launch its synthetic source CLI inside the workspace sandbox using only explicit fixture paths and the selected Codex profile.

## Current Behavior

The workout fixture launched the TSX CLI binary, which created a sandbox-blocked Unix-socket IPC server. It also depended on ambient shell variables that an alternate Codex profile could filter, while output-only command rendering hid the session identifier needed to finish a yielded effect. These independent runner details made a correct production-derived journey fail before its result could be verified.

## Possible Solution

Launch Node with TSX's import loader and the repository base TypeScript config, bake synthetic fixture paths into the wrapper, pass the minimal required shell environment explicitly, and preserve the full command result so yielded effects can be polled to completion.

## Minimal Reproducible Example

1. Run a focused real-Codex workout journey in the workspace-write sandbox.
2. Let its synthetic `vault-cli` wrapper invoke the TSX CLI binary or depend on ambient fixture variables.
3. Observe an IPC permission failure, missing fixture state, or an unpollable yielded command before the production-derived journey completes.

## Context

This blocks required live assistant proof and obscures whether the production-derived workout effect and card reply are correct.
