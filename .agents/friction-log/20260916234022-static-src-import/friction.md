---
title: 'Static src import in harness-backed assistant tests bypasses vi.doMock and hangs'
severity: 'minor'
---

## Expected Behavior

A test file that uses `assistant-local-service-runtime.harness.ts` should be able to reference a production constant (for example the group reply reconsideration instruction) without changing which module instances the harness mocks.

## Current Behavior

Adding a static `import ... from '../src/assistant/local-service.ts'` to `assistant-local-service-live-input.test.ts` loads the real module graph before the harness's `vi.doMock` calls run. The first test then times out at 60s with an unhandled `ENOENT: mkdir '/vaults'` from the real turn lock, with no hint that the static import is the cause.

## Possible Solution

Keep prompt constants that tests need in dependency-free leaf modules (done for the reconsideration instruction), and have the harness assert that `local-service` was not already loaded before it installs its mocks so the failure names the offending import.
