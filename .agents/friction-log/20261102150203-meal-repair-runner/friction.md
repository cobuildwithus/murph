---
title: 'Meal repair runner aborts the whole member pass on an individual consent denial'
severity: 'minor'
---

## Expected Behavior

A one-time operator pass should retain every existing access and consent check, count members that cannot admit work, and continue to the remaining eligible members. Operator authorization failures and partial-member failures must remain terminal.

## Current Behavior

The maintenance candidate list requires active access and a saved workspace, while member-action admission separately requires historical consent. The runner treats that expected member-specific HTTP 403 like an infrastructure failure and aborts the entire pass.

## Possible Solution

Recognize only explicit member consent/access denials before any completed batch, recheck current Ops authorization before counting the skip, and leave every other failure terminal. Report aggregate denial counts without identifiers.

## Minimal Reproducible Example

Return two synthetic targets. Have the first target reject its initial action with HTTP 403 and HOSTED_CONSENT_REQUIRED, while the Ops reader remains authorized. The runner should count one skipped member and complete the second target. Repeat with an operator access denial or a denial after partial work and verify the runner stops.

## Context

The local operator client needs partial-population admission handling without weakening the existing server-side authorization owner. This reproduction requires no member data.
