---
title: 'Billing browser hydration wait retains a replaced server-rendered button'
severity: 'minor'
issue: 'cobuildwithus/murph#3247'
---

## Expected Behavior

The billing browser harness should click the current hydrated control once after React replaces server-rendered markup during hydration recovery.

## Current Behavior

The helper captures one element handle before hydration and polls that same node for a React click handler. Actual React hydration recovery can replace it, leaving the helper waiting until timeout although the current button works. Existing stage-only CI diagnostics cannot establish whether replacement caused a particular hosted run.

## Possible Solution

Re-resolve the semantic locator during bounded polling, keep one normal browser click, and exercise retained, replaced, and never-hydrated controls with actual React and Chromium in the hermetic billing lane.

## Minimal Reproducible Example

Render a synthetic button below a server-rendered div, start the current hydration helper, then hydrate that root as a section with the same button and a React click handler. React recovers by replacing the subtree. The captured-handle helper times out; clicking the current locator invokes the handler once.

## Context

This test-harness defect can prevent the protected billing matrix from reaching its real provider and canonical billing assertions. The fix must preserve those assertions and must not claim a specific CI hydration trigger without direct evidence.
