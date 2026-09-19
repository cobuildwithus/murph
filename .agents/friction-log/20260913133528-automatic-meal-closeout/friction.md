---
title: 'Automatic meal closeout fixture mutates state for help calls'
severity: 'minor'
---

## Expected Behavior

Requesting CLI help in the automatic meal closeout live fixture leaves the simulated meal unchanged.

## Current Behavior

The fixture matches meal edit and remove-photo help calls as mutations, which fabricates enrichment or cleanup and prevents the live test from proving actual effects.

## Minimal Reproducible Example

Materialize the automatic meal closeout CLI fixture with initial state and successful edits enabled. Invoke meal edit --help followed by meal remove-photo --help. The fixture previously advanced its state without a meal mutation request.

## Context

Discovered while verifying scheduled closeout admission. Help handling must precede mutation dispatch, and deterministic proof must check both unchanged help state and actual mutation transitions.
