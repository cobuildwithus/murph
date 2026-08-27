---
title: 'Live hosted assistant journey lacks production permission profiles'
severity: 'minor'
---

## Expected Behavior

A focused live assistant test should be able to run a hosted output-only turn followed by an ordinary hosted conversation turn through subscription auth without custom local setup.

## Current Behavior

The output-only turn can run with its native capabilities disabled, but the following ordinary hosted turn selects a named production permission profile. The default subscription test home has no matching permission table, so Codex rejects the turn before inference. The test must switch the follow-up to the local conversation path even though the same durable session and cold reconstruction remain exercised.

## Possible Solution

Give the real-Codex test harness a reviewed way to compose the same non-secret permission tables used by hosted runtime config while continuing to use the caller's existing subscription authentication.

## Minimal Reproducible Example

1. Create a synthetic hosted group session with a subscription-backed Codex target.
2. Complete one output-only notification turn.
3. Cold-start an ordinary hosted follow-up against the same session.
4. Observe that configuration loading fails because the selected named permission profile is absent.

## Context

This prevents a local live test from covering the final hosted permission-selection seam even though deterministic coverage can exercise it and the live model can exercise durable transcript reconstruction.
