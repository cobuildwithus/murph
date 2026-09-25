---
title: 'Goal source hover proof intermittently reads the pre-hover color'
severity: 'minor'
---

## Expected Behavior

The goal source hover proof should wait for the hovered link style to settle,
then verify that only that source changed color.

## Current Behavior

The viewport workflow can fail its hover-color assertion on both its first
attempt and built-in retry, while 153 other cases pass. A rerun of the unchanged
head passes. The test samples computed text-decoration color immediately after
hovering a source link whose component uses transition-colors.

## Possible Solution

Poll the expected hovered color change within the existing assertion deadline,
while retaining the assertion that the adjacent source color stays unchanged.
Reproduce the transition timing with a synthetic browser fixture before fixing.

## Minimal Reproducible Example

Run the Web Viewport Overflow workflow with the existing Chromium configuration.
The case named Goal guide source hover changes only the hovered source in
apps/web/e2e/viewport-overflow.spec.ts reads computed styles once immediately
after hover. The assertion can observe the same pre-hover color on CI; it passed
on the preceding equivalent-source head and on a same-head workflow rerun.

## Context

This blocked completion of an unrelated vault-storage PR after a documentation
closeout commit. Web source, browser tests and workflow configuration were
unchanged between the passing and failing heads. No assertion was weakened.
