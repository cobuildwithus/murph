---
title: 'Hosted Temporal E2E handled-through checkpoint races mailbox consumption'
severity: 'minor'
---

## Expected Behavior

The hosted Temporal orchestration E2E should wait for the system mailbox item
to reach the consumed state before asserting consumption.

## Current Behavior

The test waits only for the workspace handled-through checkpoint and then
immediately reads the mailbox row. That checkpoint can be published during
prepare, before the later record checkpoint persists consumption, so a valid
run can observe a null consumed timestamp.

## Possible Solution

Poll the mailbox item's consumed state directly while retaining the kind and
lane assertions.

## Minimal Reproducible Example

1. Enqueue a synthetic `member.channels.updated` system mailbox item.
2. Wait for the workspace handled-through checkpoint.
3. Immediately read the mailbox item.
4. Observe that the handled-through checkpoint may be visible before the
   consumed timestamp.

## Context

The same assertion failed in two release integration attempts, forcing
expensive reruns even though the runtime completed the later record checkpoint
normally.
