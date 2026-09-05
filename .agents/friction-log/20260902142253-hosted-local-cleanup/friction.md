---
title: 'Hosted-local cleanup omits standby runner artifacts'
severity: 'minor'
---

## Expected Behavior

Hosted-local cleanup should remove repository-owned standby runner containers, proxy containers, images, and persisted Durable Object state using the same scoped ownership rules as ordinary runner containers.

## Current Behavior

The cleanup class and image allowlists omit the standby runner class. Failed E2E runs can therefore leave scoped standby proxy containers and images behind, while local state cleanup retains standby Durable Object state.

## Possible Solution

Include the standby runner class and image repository in the existing cleanup allowlists and focused cleanup tests.

## Minimal Reproducible Example

Run a hosted-local E2E that provisions a standby slot and exits during readiness, then run the ordinary scoped cleanup. The standby proxy remains because its class name is not recognized.

## Context

This creates misleading residue during real standby regression testing and can consume local resources across repeated runs.
