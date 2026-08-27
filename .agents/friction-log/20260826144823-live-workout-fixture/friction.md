---
title: 'Live workout fixture uses sandbox-incompatible tsx IPC'
severity: 'minor'
issue: 'cobuildwithus/murph#2392'
---

## Expected Behavior

The focused real-assistant workout journey should execute its synthetic vault CLI inside the same workspace-write sandbox used by Murph.

## Current Behavior

The fixture invokes the tsx CLI binary, which starts an IPC socket. The workspace sandbox denies that socket with EPERM, so a correctly formed workout command fails before canonical synthetic state can be written.

## Possible Solution

Launch the TypeScript CLI through the Node binary with the reviewed tsx loader imported directly, matching the IPC-free pattern already used by another live assistant fixture.

## Minimal Reproducible Example

Run the focused coordinated-workout journey with a subscription profile that reaches the model. The model forms the expected workout start command, but the fixture exits when tsx attempts to listen on its IPC pipe.

## Context

This masks product behavior as a record-service failure and prevents the required live workout assertions from running.
