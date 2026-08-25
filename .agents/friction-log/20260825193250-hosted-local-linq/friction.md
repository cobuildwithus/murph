---
title: 'Hosted-local Linq E2E can reset an inherited caller database'
severity: 'minor'
---

## Expected Behavior

A hosted-local E2E that does not explicitly opt into database reuse should create and reset only its own isolated test database, even when the launching environment contains a database URL.

## Current Behavior

The Linq full-stack test reads the caller's database URL and passes it to the scenario harness. The scenario then treats that URL as its reset target, so launching through an environment wrapper can reset a developer database before the test begins.

## Possible Solution

Ignore inherited database URLs by default and require the existing explicit reuse control before accepting a caller-supplied database target.

## Minimal Reproducible Example

1. Export a database URL for an existing local development database.
2. Launch the opt-in hosted-local Linq first-contact E2E through an environment wrapper.
3. Observe that scenario setup resets the supplied database instead of creating an isolated test database.

## Context

This was found while validating the Web-owned first iMessage reply against the real hosted-local stack. The workaround is to unset inherited database URL variables before launching the test.
