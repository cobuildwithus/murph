---
title: 'ReviewGPT direct artifact download silently succeeds after waited target closes'
severity: 'minor'
---

## Expected Behavior

Downloading a captured assistant artifact from its exact review thread and managed lane should either write the requested file or return a nonzero actionable error.

## Current Behavior

After a waited review captures the completed response and closes its owned tab, the documented direct artifact-download command can exit successfully while creating an empty output directory. Adding the exact capture metadata then fails because the captured target no longer exists. Recovery requires using the broader thread-wake export path to reopen the same thread and download the artifact.

## Possible Solution

Make direct download reopen the exact supplied thread URL in the selected managed lane when the captured target was intentionally closed, or fail nonzero and direct callers to the thread-wake recovery command. Verify that success always means at least one requested file was written.

## Minimal Reproducible Example

1. Complete a waited review that returns one assistant-owned patch artifact.
2. Let the waited command close its owned browser target after response capture.
3. Run direct artifact download with the exact thread, lane endpoint, output directory, and artifact index.
4. Observe exit status zero and an empty output directory.
5. Retry with exact capture metadata and observe a missing-target error.

## Context

This delayed inspection and application of a required test-only coverage patch during the repository completion workflow.
