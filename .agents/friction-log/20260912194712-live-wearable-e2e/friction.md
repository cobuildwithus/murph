---
title: 'Live wearable E2E starts the full stack without preparing production Web'
severity: 'minor'
---

## Expected Behavior

The live wearable proof should finish Web compilation before starting the full stack and browser journey on a constrained executor.

## Current Behavior

The suite prepares generated Web inputs but does not create a production smoke build. Its existing startup selector therefore falls back to development Web, compiling requested routes while the Worker, orchestration, storage, and browser processes are active.

## Possible Solution

Build Web during serialized suite preparation, using the existing smoke output directory and production build memory limits, then reuse the harness production-start path.

## Minimal Reproducible Example

In a clean synthetic checkout, inspect live wearable suite preparation and the production-start selector: without a smoke BUILD_ID, the selector starts development Web. A mocked live suite can demonstrate that Vitest begins without any production Web preparation command.

## Context

This is a verification resource scheduling problem. Provider authority must remain excluded from build commands, and canonical ingestion and cleanup assertions must remain intact.
