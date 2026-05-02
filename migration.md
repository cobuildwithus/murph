# Hosted Runtime Greenfield Hard Cut

Status: complete
Last verified: 2026-05-01

The run-centric hosted runtime migration is complete. Hosted execution now uses
the mailbox plus workspace-checkpoint protocol described in the current runtime
docs. This file is a completed-state pointer, not an implementation guide.

## Current Sources

- `agent-docs/references/hosted-runtime-protocol.md`
- `apps/web/README.md`
- `apps/cloudflare/README.md`
- `packages/hosted-execution/README.md`
- `packages/assistant-runtime/README.md`

## Current Durable Hosted Primitives

- `HostedMailboxItem`
- `HostedMailboxPayload`
- `HostedMailboxLaneCounter`
- `HostedWorkspace`
- `HostedRuntimeLog`

## Ownership Rule

- `apps/web` owns hosted product/control facts, encrypted mailbox state,
  workspace pointers, logs, and status.
- `apps/cloudflare` owns runner coordination and execution callbacks.
- `@murphai/assistant-runtime` owns local-runtime restoration and execution
  inside the encrypted workspace.

## Removed Primitives And Surfaces

- `HostedIngressEvent`
- `HostedIngressPayload`
- `HostedRun`
- `HostedRunLog`
- `HostedExecutionCursor`
- web turn-input peek/adopt
- run-drain acquire/commit/finalize

For the live ownership model, recovery contract, workflow handoff rules, and
runtime boundaries, use `agent-docs/references/hosted-runtime-protocol.md`.
