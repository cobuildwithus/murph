---
title: 'Hosted-local barrier setup requires a runtime allocation before the scenario starts'
severity: 'minor'
---

## Expected Behavior

A synthetic member can arm checkpoint and provider test barriers before the first runtime allocation. Lifecycle controls still resolve the selected physical target.

## Current Behavior

Barrier routes reconcile the Postgres owner and reject an idle owner with no runner target. Foreground and checkpoint admission scenarios cannot start. The route unit fixture always supplies a target, masking the failure.

## Minimal Reproducible Example

Mock the owner as Postgres with phase idle and runnerContainerName null. Send an authenticated synthetic-member POST to the checkpoint barrier route with action arm. It returns HTTP 500 before invoking the existing test barrier control.

## Possible Solution

Keep in-memory test controls independent of physical allocation; retain selected-target lookup for lifecycle mutations. Cover missing allocation in route tests.

## Context

This blocks hosted runtime admission evidence even when Temporal producer compatibility succeeds.
