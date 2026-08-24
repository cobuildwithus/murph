---
title: 'ReviewGPT direct artifact download silently succeeds after waited target closes'
severity: 'minor'
---

## Expected Behavior

Downloading a captured assistant artifact from its exact review thread and managed lane should either write the requested file or return a nonzero actionable error.

## Current Behavior

After a waited review captures the completed response and closes its owned tab, the documented direct artifact-download command can exit successfully while creating an empty output directory. Adding the exact capture metadata then fails because the captured target no longer exists. A second reproducible variant occurs while the exact target is still alive: two assistant-owned artifact buttons are visible and capture-bound download exits successfully, but the requested patch is written as a zero-byte file and the checksum artifact is not written. Recovery requires using the broader thread-wake export path to reopen the same thread or asking the owning thread to regenerate the artifact.

## Possible Solution

Make direct download reopen the exact supplied thread URL in the selected managed lane when the captured target was intentionally closed, or fail nonzero and direct callers to the thread-wake recovery command. Verify that success means the requested artifact exists, has a nonzero size, and matches any captured or companion checksum.

## Minimal Reproducible Example

1. Complete a waited review that returns one assistant-owned patch artifact.
2. Let the waited command close its owned browser target after response capture.
3. Run direct artifact download with the exact thread, lane endpoint, output directory, and artifact index.
4. Observe exit status zero and an empty output directory.
5. Retry with exact capture metadata and observe a missing-target error.
6. In a live-target variant, return visible patch and checksum buttons from the assistant, run the same capture-bound downloads, and observe exit status zero with a zero-byte patch and no checksum file.

## Context

This delayed inspection and application of a required test-only coverage patch during the repository completion workflow.
