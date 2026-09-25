---
title: 'Native Codex Cargo test launch times out before voice initialization'
severity: 'minor'
---

## Expected Behavior

The documented native patch verification should give a reproducible local command that reaches the public Live lifecycle assertions with the pinned helper installed.

## Current Behavior

On macOS, Cargo's focused app-server test invocation repeatedly times out at the first initialize request, before any voice session is created. Ten remaining public Live cases pass. Running the same compiled test executable from the native workspace root with the candidate app-server binary explicitly selected passes all eleven cases without changing source or deadlines. The prior app-server binary also passes the isolated case through that direct launch. The launch-context difference is demonstrated; its underlying cause is not established.

## Possible Solution

Provide a canonical focused native verification entrypoint that fixes the working directory, candidate binary, and matching helper layout. Investigate Cargo launch-context differences before changing initialization deadlines.

## Minimal Reproducible Example

Build the pinned patched release with its matching Code Mode helper beside the app-server executable. Run `cargo test --locked -p codex-app-server --test all public_live -- --test-threads=1`, then run the resulting test executable directly from the native workspace root with the same filter and candidate app-server selected through its standard binary environment override. Compare initialization completion and the number of executed lifecycle tests.

## Context

This obscured proof for a native voice refactor and required separate launch-context validation. No product timeout or runtime behavior was changed.
