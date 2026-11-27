---
title: 'Complexity diff treats a moved and simplified function as new debt'
severity: 'minor'
issue: 'cobuildwithus/murph#4920'
---

## Expected Behavior

Moving a resolver and reducing its branches should preserve its complexity baseline.

## Current Behavior

The default diff recognizes exact function moves, but an edited moved function is compared against zero in its new file. A row mapper reduced from complexity 37 to 31 still fails the combined diff. Comparing the collapse against the preceding plain-move commit passes.

## Minimal Reproducible Example

Move a function above the complexity threshold to a new module and commit the move. Simplify it in a second commit. Compare `pnpm complexity:diff` against `pnpm complexity:diff --base HEAD` before the second commit.

## Context

This forces staged verification for behavior-preserving resolver extraction. The default report obscures the actual reduction across the move.
