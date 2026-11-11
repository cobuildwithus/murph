---
title: 'Device admission proof requires idle polling even when provider admission closes immediately'
severity: 'minor'
---

## Expected Behavior

The admission fixture should prove one deferred import and accurate timing diagnostics whether the provider closes admission before or after the service enters its polling loop.

## Current Behavior

The fixture requires a positive idle-yield duration. A deferred import can resume immediately after provider admission closes, without entering the polling loop, so a zero duration is correct. The independent deferred-import counter still records the interrupted preparation.

## Minimal Reproducible Example

In the synthetic provider case, hold the importer rejection until the existing provider-start callback closes admission. The unchanged positive-duration assertion fails even though import, acknowledgment, cancellation and retry invariants pass.

## Context

A deterministic fixture check can compare the emitted total with the rounded real diagnostic sum, explicitly cover zero on immediate resume, and retain positive-duration proof while admission stays open.
