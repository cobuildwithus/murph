# Gateway core surface plan

## Goal

Create the smallest durable foundation for a Murph-hosted or self-hosted conversation gateway that can later expose an OpenClaw-like MCP surface without forcing local, hosted, and CLI concerns to share one transport-specific implementation.

## Why this first

Murph already has most of the runtime ingredients:

- inbound capture identity in `@murph/inboxd`
- route-aware assistant bindings and outbox intents in `assistant-state/**`
- a local daemon boundary in `@murph/assistantd`
- a hosted execution/control-plane split across `apps/web` and `apps/cloudflare`

What it lacks is a transport-neutral gateway contract that all of those layers can depend on.

Without that contract, any direct MCP or HTTP/SSE work would couple too tightly to today's assistant session model or to the current Cloudflare one-shot runner.

## Target rollout

### Step 1 - freeze the gateway-core boundary

Land a new `murph/gateway-core` headless surface that defines:

- canonical route/conversation/message/attachment/event/permission contracts
- a `GatewayService` interface for local, hosted, and MCP adapters
- route normalization helpers that translate existing assistant bindings and inbox captures into the new gateway route model

This step should stay behavior-neutral: no daemon routes, no hosted projection changes, and no MCP server yet.

### Step 2 - add a local read projection and assistantd gateway API

Build a read-first local implementation over the current Murph substrate:

- derive conversations from inbox captures plus assistant session bindings
- expose read-only conversation/message/attachment operations through `assistantd`
- keep `sessionKey` opaque to transport clients even if the local implementation initially maps it to current runtime ids internally

This is the first step that should make the new surface useful to external clients.

### Step 3 - add send/events plus hosted/MCP adapters

Finish parity with the intended OpenClaw-like surface:

- route-bound `messages_send`
- short-retained event cursor feed for `events_poll` / `events_wait`
- permission queue plumbing
- hosted projection/hot path in Cloudflare rather than rehydrating the full workspace on every read
- local stdio plus remote HTTP/SSE MCP adapters on top of the same `GatewayService`

## Constraints

- Keep canonical health truth in the vault and out of gateway contracts.
- Treat the gateway plane as operational state, not canonical health memory.
- Keep the new surface transport-neutral so local daemon, self-hosted server, and Murph-managed hosted deployments can share the same core.
- Prefer additive scaffolding in this patch; larger storage moves can happen in later steps once the interface is stable.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
