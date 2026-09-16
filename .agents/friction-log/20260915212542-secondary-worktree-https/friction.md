---
title: 'Secondary worktree HTTPS smoke reaches an older proxy target'
severity: 'minor'
---

## Expected Behavior

The namespaced hosted-local stack should serve its advertised HTTPS origin through the selected worktree port or clearly stop when that proxy is owned by another session.

## Current Behavior

The stack reported ready with its Web listener on the isolated worktree port, but the advertised HTTPS origin returned 502. The existing Caddy admin configuration still targeted port 3000. The listener belonged to an older development session, while a direct request to the new worktree Web port returned 200.

## Possible Solution

Check the HTTPS listener and upstream before declaring readiness. Fail with an ownership-aware message when an existing proxy belongs to another session, or support a separately namespaced HTTPS origin.

## Minimal Reproducible Example

Leave a root development Caddy proxy listening on the canonical local HTTPS origin with its upstream at port 3000. Stop that Web app, then run pnpm dev:worktree example. Compare direct worktree-port health with the advertised HTTPS origin and inspect the existing proxy upstream.

## Context

This blocks authenticated provider OAuth tests even though the isolated Web and Worker services start successfully. Reconfiguring the other session's proxy requires an explicit handoff; terminating unrelated Caddy processes is not an acceptable workaround.
