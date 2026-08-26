---
title: 'Live assistant journey hides reply behind state assertions'
severity: 'minor'
---

## Expected Behavior

A focused real-assistant journey should print its private-free synthetic reply before assertions that may fail, so a behavioral miss can be diagnosed from the test result.

## Current Behavior

The coordinated-exercise journey prints the synthetic reply only after asserting that canonical workout state exists. When the model creates no workout, the assertion exits first and hides the reply that explains the miss.

## Possible Solution

Print the compact synthetic scenario, reply, card kind, and observed exercise names immediately after reading the turn result and synthetic vault state.

## Minimal Reproducible Example

Run the focused coordinated-exercise live journey with an authenticated profile that reaches the model but creates no workout. The failure reports only a zero workout count and no synthetic reply.

## Context

This slows prompt-regression diagnosis while adding no privacy protection because the journey already uses synthetic inputs and state.
