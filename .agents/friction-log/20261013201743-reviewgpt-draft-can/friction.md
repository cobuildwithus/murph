---
title: 'ReviewGPT draft can stall at disabled Send after attachment readiness'
severity: 'minor'
---

## Expected Behavior

The managed ReviewGPT implementation-authoring command should submit its staged prompt after the guarded repository attachment is ready, or fail promptly with a useful recovery classification.

## Current Behavior

One configured managed lane confirmed the requested model, one ready attachment, and a populated composer, but exhausted staging with `Auto-send failed` and `send-button-disabled`. That implementation request was never accepted. Four alternative lanes then failed before submission because their existing profile locks had no reachable debugging endpoint; their processes were left untouched.

## Minimal Reproducible Example

Run `pnpm --silent review:gpt --prompt-file <synthetic-prompt> --wait --response-marker IMPLEMENTATION_COMPLETE --response-file <local-response>` against a clean repository snapshot. Observe the attachment-ready and composer-populated messages followed by disabled Send. This is a captured intermittent UI failure; no general deterministic trigger has been established.

## Context

This delays authorized telemetry implementation before any model work starts. No production content, browser account details, or private attachment contents are required to diagnose the staging state.

For implementation authoring only, the same first lane accepted a supported `--no-artifacts --no-zip` request containing the relevant public source inline. A later guarded final-review snapshot also submitted and completed on that lane, confirming the failure is intermittent rather than a permanent attachment limitation. The authoring workaround does not waive final review's guarded, exact-head repository snapshot requirement.
