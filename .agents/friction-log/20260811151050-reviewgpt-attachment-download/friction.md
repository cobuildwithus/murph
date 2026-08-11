---
title: 'ReviewGPT attachment download times out after successful response capture'
severity: 'minor'
---

## Expected Behavior

After an attached patch is returned in a completed ReviewGPT thread, `cobuild-review-gpt thread download --artifact-index 0` should save that assistant-owned artifact through the same managed browser endpoint used for the send.

## Current Behavior

The send and response capture complete, the thread reports an attachment and checksum, but the download waits for a matching CDP event until its 120-second timeout and writes no file. The failure reproduced for two separate small patch attachments in the same task. Recovery required asking the existing thread to replay the already-attested patch inline, then independently validating the pasted diff against the exact baseline.

## Possible Solution

Expose a stable authenticated artifact URL or artifact identifier in the captured response metadata and let `thread download` fetch it directly. At minimum, emit which CDP event and artifact metadata were observed so endpoint, selector, and browser-download failures can be distinguished without replaying the response.

## Minimal Reproducible Example

1. Send a ReviewGPT request through the managed browser and require a patch attachment.
2. Wait for the marked response to complete and confirm it reports one assistant artifact.
3. Run `cobuild-review-gpt thread download --artifact-index 0` against the same thread and managed browser endpoint.
4. Observe a matching-CDP-event timeout with no downloaded file.

## Context

This blocks the normal attachment-based remediation path and adds several minutes plus a lower-assurance transfer workaround even when the model review itself completed successfully.
