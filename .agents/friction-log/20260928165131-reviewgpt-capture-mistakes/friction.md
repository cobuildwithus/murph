---
title: 'ReviewGPT capture mistakes history loading for active response generation'
severity: 'minor'
issue: 'cobuildwithus/murph#3899'
---

## Expected Behavior

Capture a completed, stable, copyable assistant reply with the required completion marker when accepted-turn, model, and artifact gates pass. History pagination alone must not prevent completion.

## Current Behavior

threadStatusTextIndicatesBusy recognizes generic loading, so readThread reports statusBusy=true for Loading older messages…. The waiter uses stopVisible || statusBusy as generationActive and continues waiting despite a completed response and no stop control.

## Possible Solution

Distinguish history-pagination status from response-generation status. Exclude history-only loading from generation activity while preserving genuine generation detection and all accepted-turn, model, stability, completion-marker, and artifact gates. Add a regression for history loading alongside a completed reply, plus a control confirming that genuine generation still blocks capture.

## Minimal Reproducible Example

Provide synthetic UI state containing an accepted user turn and its matching completed assistant reply, unchanged across stability checks, with a copy control and the required completion marker. Set stopVisible=false; make Loading older messages… the only busy status. Satisfy the remaining capture gates and run the waiter.

Expected: capture completes. Observed: statusBusy=true keeps the waiter active.

## Context

Observed twice with history loading present. Exact-metadata recovery confirmed the accepted turn and completed reply; no stop control or capability-limit notice was present. Recovery required neither a duplicate send nor weakened identity/model gates. This is a busy-state classification issue, distinct from hard-refresh transport failure and exact-thread recovery.
