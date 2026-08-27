---
title: 'Live assistant fixture loses per-turn command environment'
severity: 'minor'
issue: 'cobuildwithus/murph#2393'
---

## Expected Behavior

A focused real-assistant fixture should provide its synthetic command adapter consistently when the app server is reused or launched under another authenticated local profile.

## Current Behavior

The workout fixture encoded required executable, loader, command-log, and synthetic-vault paths only in per-turn environment variables. A reused app-server process could omit those values, causing the adapter to exit before invoking the synthetic canonical CLI.

## Possible Solution

Materialize a session-owned wrapper that embeds its already-resolved synthetic paths and depends only on PATH routing at execution time.

## Minimal Reproducible Example

Run the focused coordinated-workout journey through an alternate authenticated local subscription home after another live journey. The model issues the expected command, but the wrapper exits because its fixture-specific environment is empty.

## Context

This looks like an assistant execution failure even though the production prompt and command are valid, and it makes alternate-profile live verification unreliable.
