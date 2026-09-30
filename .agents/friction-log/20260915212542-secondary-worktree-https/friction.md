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

## Verified current variant

A composed reproduction confirmed that missing Caddy lets direct Web and Worker health pass while the advertised HTTPS proxy still returns 502 from a stale upstream. Automatic proxy startup now rejects missing Caddy or the repository Caddyfile when the canonical HTTPS origin is advertised. Explicit proxy skipping and ordinary direct HTTP behavior are preserved.

The historical report does not establish whether Caddy was available on that session's PATH. This repair addresses the verified missing-required-proxy variant; it does not claim the original stale-proxy cause or authorize taking over another session's proxy.

## Occupied-listener resolution

A composed regression also confirms that direct health can win before the new
proxy reports its bind failure. Required canonical HTTPS startup now checks the
existing TCP port admission owner before launching Caddy and rejects an occupied
listener with an explicit handoff message. Cleanup remains limited to the new
stack's own children. Explicit proxy skipping and direct HTTP are preserved.
