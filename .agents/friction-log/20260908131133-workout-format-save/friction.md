---
title: 'Workout format save help advertises an invalid type and omits allowed modes'
severity: 'minor'
issue: 'cobuildwithus/murph#3072'
---

## Expected Behavior

The command help should supply valid activity-type examples and accepted exercise-mode values so callers can construct a structured routine without trial-and-error writes.

## Current Behavior

The workout format save type option advertises a spaced strength activity label even though the structured payload requires a slug. The compact exercise grammar lists the mode key but does not list accepted values. These omissions cause avoidable validation failures before persistence.

## Possible Solution

Use a valid activity-type slug in the example and derive the mode list from the existing contract enum.

## Minimal Reproducible Example

Inspect `vault-cli workout format save --help`. Construct a synthetic routine using the advertised spaced strength activity type, or the unsupported mode `bodyweight_reps`. Validation rejects these inputs; the accepted spellings are `strength-training` and `bodyweight`.

## Context

Found while verifying canonical routine saves. The correction changes help metadata only and preserves existing parsing and write authority.
