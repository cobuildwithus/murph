---
title: 'Health screenshot studies open global dialogs over unrelated examples'
severity: 'minor'
---

## Expected Behavior

An anchored synthetic study on /screenshots/health should be inspectable independently, including its accessible names and controls.

## Current Behavior

Environment voice-dialog examples mount open portals outside the inert study wrapper. Those dialogs cover unrelated studies and suppress their accessible names. Removing the target study's inert attribute alone does not make its controls accessible.

## Minimal Reproducible Example

Open /screenshots/health#personal-patterns in the local smoke environment. Inspect the open Environment report dialogs and the accessibility tree for the Patterns study.

## Context

Responsive Patterns verification uses the existing components catalog instead. Keep portal examples scoped to their own study so unrelated presentation proof remains usable.
