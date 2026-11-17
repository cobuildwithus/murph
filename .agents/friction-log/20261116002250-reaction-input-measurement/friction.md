---
title: 'Reaction input measurement stops before reporting captured request sizes'
severity: 'minor'
---

## Expected Behavior

The opt-in reaction input measurement should report base and candidate complete
request sizes while separately identifying capability-proof failures.

## Current Behavior

The classified-heart fixture reaches the credential-free provider, then fails its
native-tool assertion because the request advertises functions.apply_patch. The
assertion runs before the size report, so no comparison is emitted. The game
input measurement completes with the same installed App Server. A diagnostic
capture confirms identical native tool declarations at base and candidate,
including apply_patch; this prompt change did not add that declaration.

## Minimal Reproducible Example

Run MURPH_MEASURE_REACTION_INPUT=1 with MURPH_REACTION_INPUT_BASE set to the PR
base, then run assistant-reaction-input-measurement.test.ts with the
classified-heart test selector through the assistant-engine Vitest config.
The test exits 1 before printing reaction-input-proof.

## Possible Solution

Keep capability enforcement independently tested, and emit bounded measurement
metadata before its assertions. Investigate the current native tool declaration
against the confinement profile without weakening the effect boundary.

## Context

This prevents complete classifier input evidence for a prompt-only change.
No credentials or external provider calls are involved in the measurement.
