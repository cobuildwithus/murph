---
title: 'Hosted tool-call fixture holds HTTP headers instead of an active stream'
severity: 'minor'
issue: 'cobuildwithus/murph#4229'
---

## Expected Behavior

Hosted steering proof should hold back tool-call content on an established Responses API stream, admit a corrective input, and require the corrected request before releasing any stale tool content. Other scenarios must retain their existing before-response state barrier.

## Current Behavior

Candidate hosted proof 39328858199 attempt 2 built Codex 0.163.0, then failed the lost-active-operation scenario before the other three scenarios ran. The function-call fixture's beforeResponse hook awaited its gate before sending HTTP headers. Upstream 0.163.0 session/turn.rs awaits stream creation with full-turn cancellation only; the instant-steer preemption token applies to the subsequent stream-read loop. The fixture was holding the wrong boundary for this assertion.

## Possible Solution

Keep the existing header barrier and add an explicit beforeStreamContent hook after response.created. The hosted scenario waits for that opening event before steering, while retaining the stale-tool, exact reply, mailbox, fence-clearance, and fresh-wake assertions. The focused wire test fails before the hook is implemented and passes afterward; all 40 provider-support tests pass, including the unchanged header-barrier case. Three focused real-binary cases also pass, including proof that the held shell tool never creates its file.

## Minimal Reproducible Example

Queue a synthetic function-call response with its HTTP response gate held. Admit a follow-up and require the next provider request before releasing that gate. Compare with a streamed-content gate that first emits response.created but no function-call item. Only the latter exercises instant steering after stream establishment.

## Context

A native image build preceded the fixture failure, making an inexpensive provider-boundary regression important before rerunning the hosted scenario. This changes test infrastructure and clarifies an existing upstream boundary; it does not change production steering or relax its required effects.
