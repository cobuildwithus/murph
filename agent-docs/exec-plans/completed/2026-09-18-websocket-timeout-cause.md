# Investigate warm WebSocket timeout cause and protect reply recovery

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal

Explain why a warm hosted turn waited the full 30-second Codex WebSocket read
idle window before its HTTPS fallback, then remove that failure class with the
smallest change that keeps native Codex as the only transport and retry owner.

## Success criteria

- Separate proved transport behavior from platform-failure hypotheses.
- Obtain the explicitly requested ReviewGPT investigation on current source.
- Keep healthy long reasoning, streaming, cancellation, and single delivery.
- Prove the new hosted transport policy against the pinned Codex binary.
- Run focused tests and typechecks; leave rollout to the normal deploy path.

## Scope and authority

Read-only operational diagnosis plus local code, test, and documentation
changes. No production deployment, rollback, member-facing messages, or remote
mutation. Private diagnostic rows and correlations stay out of the repository.

## Findings

- The slow turn's reused relay WebSocket lived inside one Cloudflare Worker
  outbound-relay invocation (the Containers `ContainerProxy` entrypoint running
  Murph's relay). Fifteen seconds after the previous `response.completed` and
  three seconds before the next member message, that invocation ended with an
  opaque platform "internal error"; the Worker script version was unchanged, so
  no deploy was involved, and CPU time was far below limits.
- Fleet-wide over 36 hours, 34 of 36 such invocation errors were Responses
  relays and 31 died while idle between requests (idle gaps of roughly 6 to 400
  seconds, connection ages of roughly 18 to 440 seconds), so this is not a fixed
  idle cutoff. None recorded a close milestone; no close reaches the container
  because its TCP peer is the platform's outbound proxy, not the Worker.
- The pinned Codex 0.153.4 client checks only its own stream state before
  reusing a cached connection and runs no read pump while idle, so the next
  turn wrote into a dead-but-open socket, hit "idle timeout waiting for
  websocket" after 30 seconds, then fell back to HTTPS for the session. Four to
  seven member turns a day paid that window; most dead sockets were never
  reused because runtimes idle out first.
- No Codex knob detects a dead reused socket faster, and no newer Codex release
  (0.154, 0.155) changes reuse liveness.

## Decision

Hosted Codex streams every Responses request over HTTPS
(`supports_websockets = false`) so no provider connection survives an idle gap
inside a Worker invocation. `stream_max_retries = 1` keeps the single native
replay hosted turns previously received through the WebSocket-to-HTTPS
fallback; the worst case for one request stays two idle windows. The Worker
relay, its diagnostics, and the engine's WebSocket fixtures stay in place
because they still prove native transport behavior and guard any client that
upgrades; retiring them is a separate change once production confirms zero
relay traffic.

Alternatives not taken: closing idle relays from the Worker (still needs a
native retry to avoid sticky HTTPS fallback and breaks long tool round trips),
hosting the relay inside the Durable Object (unproven against the same platform
failure), and a shorter idle timeout (cuts healthy quiet reasoning).

## Tasks

1. Correlate content-free observations across runtime and Cloudflare metadata.
2. Give ReviewGPT current source and redacted findings, emphasizing root cause.
3. Select the smallest correction from evidence.
4. Implement the hosted transport policy with a pinned-binary regression.
5. Verify, review, document the durable contract, and commit the scoped result.

## Verification

- `hosted-runtime-codex-config.test.ts`: rendered hosted TOML for every
  provider, `codex.prepare` transport diagnostics, and a new pinned-binary case
  proving zero WebSocket upgrades across cold and warm turns, exactly one
  native HTTPS replay after an acknowledged stream failure, and turn failure
  after two failures with no third request.
- `hosted-runtime-workspace-entrypoint-startup.test.ts`: `codex.prepare`
  diagnostics carry the new transport mode and retry budget.
- assistant-runtime typecheck.

## Progress

Evidence gathered read-only from the runtime-log database and Cloudflare
Workers observability. ReviewGPT round one recommended the same HTTPS-only
policy; a cause-focused follow-up round is in flight. Implementation and the
regression are in this checkout.
Completed: 2026-09-18
