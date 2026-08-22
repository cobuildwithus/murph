---
title: 'ReviewGPT closes exact capture target before verified artifact download'
severity: 'minor'
---

## Expected Behavior

A waited ReviewGPT response that records an assistant artifact should keep enough exact-turn browser authority for `thread download --capture-metadata` to retrieve those bytes, and the downloaded bytes should match the SHA-256 stated in the response.

## Current Behavior

After a successful waited response, the exact managed tab may close before artifact download. The capture-bound downloader then refuses recovery because the recorded target no longer exists. Reloading an already-open tab can rehydrate the exact captured user and assistant turn, but the recovered artifact bytes can have a different SHA-256 from the response claim.

## Possible Solution

Retain or rehydrate the exact captured turn through artifact download, and attest the actual downloaded bytes rather than an in-sandbox pre-download file.

## Minimal Reproducible Example

1. Send a waited ReviewGPT request that returns one patch attachment and a printed SHA-256.
2. Let the waited command complete and close its managed tab.
3. Run `thread download` with the emitted capture metadata.
4. Observe that exact-target recovery fails closed; after exact-turn rehydration, compare the downloaded patch SHA-256 with the response value.

## Context

This blocks deterministic application of a ReviewGPT-authored merge-conflict patch and forces extra provenance recovery before local validation.
