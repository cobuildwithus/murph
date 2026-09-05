---
title: 'Linq tool-surface proof selects later scheduled provider request'
severity: 'minor'
---

## Expected Behavior

The first-contact E2E should verify the advertised tool set for the direct inbound reply it exercises.

## Current Behavior

The scenario selects the last captured provider request after mailbox completion. Later scheduled work can advertise a smaller tool set and replace the direct reply as that last request, causing the direct-reply response-card assertion to fail.

## Minimal Reproducible Example

Capture a synthetic direct inbound reply followed by a scheduled provider turn without response-card availability. Apply the direct-reply tool assertion to the last request; it checks the scheduled turn instead.

## Possible Solution

Record the provider-request baseline before the synthetic inbound message and select its first matching request by exact unique input. Preserve the complete direct-reply tool assertion.

## Context

Selecting the exact inbound request improves proof attribution; it does not establish the cause of the historical predeploy failure. That failure came from expecting deferred card tools in the resident code-mode inventory and is corrected by the shared E2E helper. Direct reply tool availability remains required through its existing discovery contract.
