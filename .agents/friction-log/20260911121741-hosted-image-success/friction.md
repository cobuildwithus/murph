---
title: 'Hosted image success fixtures retain Starter-only entitlement'
severity: 'minor'
---

## Expected Behavior

Hosted image-generation success journeys should seed an eligible paid subscription before expecting generated media to be delivered.

## Current Behavior

The scheduled image reminder and generated-image delivery fixtures seed only the default Starter grant. The image entitlement owner correctly rejects generation, but the reminder journey later reports a generic missing-send timeout, blocking protected deployment.

## Possible Solution

Use the existing member seed's explicit paid-plan and synthetic Stripe subscription fields in the image success fixtures. Preserve default Starter coverage and production entitlement enforcement.

## Minimal Reproducible Example

Run the first process shard of the stubbed Linq scheduled reminder scenario with the default member seed. Inspect the image tool's protocol-owned output: generation is rejected for missing subscription. Seed the same synthetic account with an eligible plan and subscription, then repeat the unchanged image-delivery assertion.

## Context

An unrelated deployment was blocked by a stale positive image fixture. The diagnosis used only synthetic hosted-local accounts; no production records or credentials are needed.
