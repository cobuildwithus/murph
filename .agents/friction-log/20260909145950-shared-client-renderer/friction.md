---
title: 'Shared client renderer cannot dispatch focused input keyboard events'
severity: 'minor'
---

## Expected Behavior

A component mounted with renderClientComponent can focus an input and dispatch Enter to exercise its keyboard action.

## Current Behavior

React selects its legacy input-event fallback in LinkeDOM. Keyboard dispatch without focus fails reading a missing instance; focusin fails because attachEvent is absent. The hero-clocks-in tests already carry their own compatibility hooks.

## Minimal Reproducible Example

Render a controlled input with an onKeyDown handler using the shared client renderer. Dispatch focusin followed by a bubbling keydown event with key Enter.

## Possible Solution

Centralize faithful legacy input-event hooks in the shared renderer or run these interactions in the browser harness.

## Context

Goal handoff keyboard regression proof needs the same compatibility hooks already duplicated in another component suite.
