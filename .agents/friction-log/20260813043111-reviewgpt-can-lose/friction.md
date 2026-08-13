---
title: 'ReviewGPT can lose a ZIP after confirming the attachment is ready'
severity: 'minor'
issue: 'cobuildwithus/murph#1770'
---

## Expected Behavior

A waited ReviewGPT run that reports `attachments confirmed` and auto-sends should leave the guarded ZIP available to the model for the submitted turn.

## Current Behavior

A completion-specialists run confirmed one ready ZIP in the composer, submitted the turn, and later returned `SPECIALIST_OUTCOME: INVALID` because the conversation contained no uploaded files. The wrapper treated attachment staging as successful even though the submitted turn had no usable attachment.

## Possible Solution

After send, verify that the submitted user turn still exposes the expected attachment before entering the long response wait. Fail fast with a pre-completion staging error if it does not.

## Minimal Reproducible Example

1. Run the completion-specialists preset with `--wait`, a response marker, and a response file.
2. Observe the wrapper report one ready attachment and successful auto-send.
3. Observe the model report zero conversation files and an invalid outcome.

## Context

This wastes a full managed-browser review attempt and makes an apparently successful attachment preflight unreliable.
