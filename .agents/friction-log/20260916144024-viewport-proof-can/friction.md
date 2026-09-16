---
title: 'Viewport proof can fail during style injection on an unrelated analytics CSP event'
severity: 'minor'
---

## Expected Behavior

The viewport proof should reach its overflow measurement while the page preserves its content security policy and external requests remain blocked.

## Current Behavior

On CI, the comparison page case can fail inside Playwright style injection when a development analytics script violates the page policy. The exception occurs before overflow measurement, including the built-in retry. The same viewport source and runtime layout passed in an earlier run, so this is intermittent proof interference rather than evidence of horizontal overflow.

## Possible Solution

Keep the page policy and overflow assertions intact. Investigate isolating development analytics in the proof environment or applying the animation-freeze style without attributing an unrelated script policy event to that operation.

## Minimal Reproducible Example

Run the Web Viewport Overflow workflow against a Ready PR. In the comparison route case at desktop width, leave the existing non-loopback request blocking and animation-freeze setup enabled. An analytics policy event racing style injection can reject the setup before measurement. A rerun may pass; the race needs a deterministic synthetic regression before correction.

## Context

This required investigation and a rerun while completing an unrelated device-import patch. No viewport, analytics, content security policy, or layout source changed in that patch.
