---
title: 'Environment recovery E2E budgets one checkpoint floor for successor work'
severity: 'minor'
---

## Expected Behavior

Environment ordering and recovery scenarios should prove durable completion across all legitimate successor passes while production-floor latency scenarios retain the production delay.

## Current Behavior

Two Environment recovery cases run with a 180-second idle checkpoint floor, but their completion helper permits only 240 seconds. A valid successor that changes canonical state restarts the floor and can outlive that single-window budget. The file already has an isolated 10-second ordering suite.

## Possible Solution

Run these recovery cases in the existing ordering suite, pass its scenario explicitly through shared helpers, and preserve the owner, delivery, handled-frontier, and replica assertions.

## Minimal Reproducible Example

Run the foreground reply priority E2E with an Environment completion followed by a dirty default-owned successor. The first checkpoint can consume most of the completion budget before the successor starts its own quiet period.

## Context

Integration proof should distinguish checkpoint timing policy from eventual ordering and recovery. Increasing a general timeout would obscure that distinction.
