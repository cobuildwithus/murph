---
title: 'Foreground priority wake fixture omits new clinical enrichment kind'
severity: 'minor'
---

## Expected Behavior

The foreground-priority release scenario constructs every system wake type accepted by the current hosted execution contract.

## Current Behavior

The canonical wake-kind list includes clinical-records.enrichment-requested, but buildEverySystemWake omits it. The exhaustive fixture assertion fails before the scenario reaches its foreground-priority checks, blocking Web production admission.

## Possible Solution

Add the missing wire-valid synthetic wake while preserving the exhaustive assertion. Consider checking fixture coverage before full hosted scenario startup.

## Minimal Reproducible Example

Run the foreground-reply-priority hosted-local scenario with standby allocation enabled against the current wake contract. Compare the kinds returned by buildEverySystemWake with HOSTED_EXECUTION_WAKE_KINDS after the scenario's existing conversation and environment-interview exclusions. The fixture lacks clinical-records.enrichment-requested.

## Context

Release verification fixture drift delays deployment of otherwise verified changes. This entry contains only repository contract names and synthetic reproduction steps.
