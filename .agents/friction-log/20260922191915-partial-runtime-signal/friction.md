---
title: 'Partial runtime signal mocks can escape through cyclic imports'
severity: 'minor'
---

## Expected Behavior

The PostgreSQL Stripe entitlement suite should exercise real persistence while keeping all Temporal signaling at its declared synthetic boundary.

## Current Behavior

The signal-runtime mock called importActual before replacing its two used exports. An expanded webhook import graph initialized activation consumers during that real import, allowing activation wake calls to reach the unconfigured Temporal client. Two entitlement cases failed with configured=false even though their declared signal mocks accepted the wake.

## Possible Solution

For an external-effect module whose real implementation is not under test, use a complete factory mock exposing only the required boundary functions. The task applies this correction to the entitlement suite; all 14 cases pass with local PostgreSQL after the two failures reproduced.

## Minimal Reproducible Example

Run hosted-stripe-webhook-entitlement-postgres.test.ts with its PostgreSQL flag enabled and a migrated isolated loopback test database. A signal-runtime factory that awaits importActual can bypass its replacement during cyclic initialization; a complete factory mock removes the escape.

## Context

A poll webhook integration exposed this existing test isolation weakness. No production billing or signaling behavior changes are required.
