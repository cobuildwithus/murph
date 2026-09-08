---
title: 'Hosted Temporal E2E confuses row timestamps with lane consumption'
severity: 'minor'
issue: 'cobuildwithus/murph#2772'
---

## Expected Behavior

The hosted Temporal orchestration E2E should assert system mailbox consumption
through the lane's canonical consumed sequence.

## Current Behavior

The test treats the mailbox row's `consumed_at` timestamp as canonical for the
system lane. Workspace checkpointing intentionally advances the system lane's
`consumed_seq` without stamping individual system rows, so the assertion can
never pass even after successful handling.

## Possible Solution

Read and assert the system lane's `consumed_seq`, and retain the row assertion
only for item identity and the intentional null timestamp.

## Minimal Reproducible Example

1. Enqueue a synthetic `member.channels.updated` system mailbox item.
2. Wait for the workspace handled-through checkpoint.
3. Read the system lane's consumed sequence and the mailbox item.
4. Observe that the lane frontier reaches the item while its row timestamp
   remains null by design.

## Context

The invalid row-level assertion caused repeated release integration failures
even though the canonical system-lane frontier had advanced normally.
