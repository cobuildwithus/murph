# Reject occupied managed HTTPS listeners

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and invariant

A hosted-local stack advertising canonical HTTPS must reject an existing proxy
listener before reporting direct Web/Worker health as readiness. Never signal,
reconfigure, or adopt another session's listener. Explicit proxy skipping and
direct HTTP development remain available.

## Owner and cause

`maybeStartTlsProxy` in the existing hosted-local stack owns automatic Caddy
startup. Web and Worker readiness can complete before a newly spawned Caddy
reports its bind failure. The composed regression proves the current stack
resolves readiness even when the existing port admission owner would reject
the occupied canonical port. The earlier missing-Caddy repair addresses a
separate variant and remains intact.

## Smallest correction

Await the existing `assertPortAvailable` owner before starting required Caddy.
Derive its port from the existing canonical HTTPS origin. No proxy takeover,
new state owner, recovery service, dependencies, or deployment changes.
A bind collision stops startup and cleans up only children this stack started.

## Verification

- New composed regression failed before the fix: startup resolved instead of
  rejecting an occupied managed HTTPS listener.
- Full stack and real TCP suites passed on the final candidate: 91 cases,
  sequential files with unchanged deadlines. Package typecheck passed.
- Run existing real TCP admission proof against an occupied loopback listener;
  retain the no-signalling assertion. Use the canonical origin's documented
  loopback address, since wildcard binding can coexist with an address-specific
  listener on some platforms.
- Verify explicit proxy skipping, optional Caddy, available canonical proxy,
  missing Caddy and missing config paths.
- Parent review, privacy scan, complexity guard and docs drift passed.
  Required final ReviewGPT, exact-head CI, live merge tree,
  privacy scan, verified merge and matched issue closure remain pending.

## Scope and risks

Internal developer tooling only; no production authentication, runtime, or
network permission change. Port admission is a preflight, not a durable lock;
existing child-exit handling still owns a later bind race. It does not claim a
general TLS readiness proof or support concurrent canonical HTTPS stacks.
Completed: 2026-09-29
