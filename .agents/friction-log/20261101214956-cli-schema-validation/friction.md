---
title: 'CLI schema validation hides actionable authored retry guidance'
severity: 'minor'
issue: 'cobuildwithus/murph#4440'
---

## Expected Behavior

A command field with a bounded Zod validation message should expose that safe correction guidance to the caller.

## Current Behavior

A custom name length or prefix rejection becomes a generic invalid-input message and generic field error. The caller cannot learn the permitted length or naming rule without another schema read. The meal command must validate in its handler and throw a VaultCliError to preserve useful retry guidance.

## Minimal Reproducible Example

Register an Incur command with a string option constrained to 40 characters and a custom max-length message. Invoke it with a synthetic 41-character string through the repository CLI envelope wrapper. Observe generic message and fieldErrors text rather than the authored constraint.

## Context

Discovered while adding bounded meal-name validation. An explicit handler error is the current workaround; no private inputs are needed to reproduce it.
