---
title: 'Foreground priority proof requires an obsolete system-owner replacement'
severity: 'minor'
---

## Expected Behavior

The composed foreground proof accepts a consented exact-child wake that retains the system-mailbox fence, while requiring canonical publication ordering, one accepted reply, and subsequent system progress.

## Current Behavior

The controller supports foreground execution within an accepted active system owner, but the E2E requires a default-mode replacement attempt. It fails after the foreground reply has already succeeded. Its continuation check also excludes progress by the retained owner, and the protocol prose still describes forced Web-direct replacement.

## Minimal Reproducible Example

Hold a system canonical-publication barrier, append an authenticated conversation, verify no provider start while the barrier is held, then release it. The foreground provider may start under the same system-mailbox attempt. The existing real-controller tests cover accepted exact-child wakes for direct and Temporal callers.

## Context

The mismatch blocks hosted foreground admission despite supported ownership reuse. Correct the proof and owner documentation without changing runtime behavior or weakening delivery and publication assertions.
