---
title: 'Linq webhook E2E member labels can drift from local inbound allowlist'
severity: 'minor'
---

## Expected Behavior

Every member label accepted by the hosted-local Linq webhook factory is represented in the scenario's generated local inbound allowlist.

## Current Behavior

The member labels used by the tests and the labels used to build the allowlist are separate string lists. Adding a test with a new label can leave its generated phone absent from the allowlist, so the webhook is correctly ignored before the behavior under test runs.

## Possible Solution

Use one typed label tuple for both member creation and allowlist generation.

## Minimal Reproducible Example

Add a hosted-local webhook case that calls `createActiveLinqWebhookMember("synthetic-case")` without separately adding `synthetic-case` to the allowlist builder, then run the Linq webhook E2E.

## Context

This drift made the cross-repository integration aggregate fail after an otherwise independent public-main change.
