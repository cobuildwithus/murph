---
title: 'ReviewGPT waited capture hides terminal generation errors'
severity: 'minor'
---

## Expected Behavior

The repository final-review launcher should distinguish an active response from a terminal generation failure while preserving the accepted request and its capture metadata.

## Current Behavior

After an accepted review request, the browser can show a terminal generation error with a retry action while the waited capture continues reporting only that it is waiting. This concealed a failed response for more than forty minutes during release verification. An inspection of the task-owned target was needed to identify the state; retrying the same accepted request retained the existing capture owner.

## Possible Solution

Add a terminal-generation-error fixture to the review integration and surface an explicit recoverable failure or bounded retry path tied to the exact accepted turn. Do not create another prompt, silently accept an earlier response, or discard capture identity.

## Minimal Reproducible Example

Start an exact-head waited review with a synthetic repository fixture. After the user turn is accepted, simulate the browser's terminal generation-error state. Observe that capture continues its normal waiting loop instead of exposing the failed generation to the caller.

## Context

The repository uses this capture as a release gate. Indistinguishable active and failed states delay authorized deployment and invite duplicate submissions. No review transcript or private browser data is needed to test the distinction.
