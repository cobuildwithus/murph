---
title: 'ReviewGPT attachment capture accepts notes when the patch is missing'
severity: 'major'
issue: 'cobuildwithus/murph#2388'
---

## Expected Behavior

When a ReviewGPT response says it attached an implementation patch, the wait/export workflow should download that patch and fail closed if no patch attachment exists.

## Current Behavior

The attachment capture selected a citation notes file while the response claimed a patch was attached. The notes explicitly reported that the patch was missing, but the automated result did not surface that mismatch as a failed implementation handoff. Recovering required opening the authenticated thread, inspecting the attachment popup, downloading the notes manually, rejecting them, and requesting a corrected patch in the same thread.

## Possible Solution

Match downloaded attachments against the response's declared filename and requested artifact type, inspect the popup filename before accepting a citation download, and return a distinct missing-attachment error when no patch exists.

## Minimal Reproducible Example

1. Ask ReviewGPT Pro for an implementation patch and require an attached unified diff.
2. Wait for the response through the repository ReviewGPT wrapper.
3. Let the response include a citation-style notes attachment but no patch.
4. Observe that automated attachment capture does not fail on the missing requested diff.

## Context

This blocked a security-sensitive cross-repository implementation handoff and consumed a second long-running ReviewGPT turn. No model transcript or private project evidence is needed to reproduce the artifact-type mismatch.
