---
title: 'Live assistant mutation assertions count read-only CLI help'
severity: 'minor'
issue: 'cobuildwithus/murph#2845'
---

## Expected Behavior

Live journey assertions distinguish help inspection from actual CLI mutations while continuing to reject duplicate or unauthorized writes.

## Current Behavior

Workout capture and ambiguous session-resolution assertions match command prefixes without excluding help flags. A help invocation can therefore fail an otherwise correct journey as an extra or unauthorized mutation.

## Minimal Reproducible Example

A recorded command list containing `workout add Mobility --type yoga` and `workout add --help` contains one write. The current prefix filter counts two. Likewise, `experiment session log --help` is inspection, not a session write.

## Context

This makes live assistant verification report false mutation failures. The task adds explicit help classification while preserving assertions on persisted results and actual mutation counts.
