# Hosted Hard-Cut Migration Guide

Status snapshot: 2026-04-27

This document is now a compatibility pointer. The old run-centric hosted plan
has been superseded by the greenfield mailbox/workspace cutover in
`migration.md` and the live protocol reference in
`agent-docs/references/hosted-runtime-protocol.md`.

## Historical Shape

- `apps/web` owns encrypted hosted mailbox rows, hosted workspace checkpoint
  metadata, hosted runtime logs, and hosted runtime status.
- Producers appended mailbox envelopes in the same transaction as the owning web
  state mutation, then best-effort nudged the runner. The active architecture is
  Temporal-only orchestration: producers append durable mailbox facts and signal
  Temporal, and Temporal calls Cloudflare `ensure-processing`.
- `apps/cloudflare` is a thin runner/container. It accepts authenticated
  Temporal processing requests/status reads, restores encrypted bundles, invokes
  `@murphai/assistant-runtime`, and persists progress through the web-owned
  mailbox/workspace/log ports.
- The assistant runtime owns mailbox import cursors, outbox/inbox semantics,
  timers, and before-delivery mailbox refresh inside its encrypted workspace
  checkpoint.
- Web no longer owns hosted run acquisition, cursor compare-and-swap,
  finalization leases, turn-input peek/adopt, or a second run/drain protocol.

## Current Durable Primitives

- `HostedMailboxItem`
- `HostedMailboxPayload`
- `HostedMailboxLaneCounter`
- `HostedWorkspace`
- `HostedRuntimeLog`
- runtime status projection from `HostedWorkspace.redactedStatusJson`, mailbox lag, and bounded logs

## Removed Production Primitives

- `HostedIngressEvent`
- `HostedIngressEventAlias`
- `HostedIngressPayload`
- `HostedRun`
- `HostedRunLog`
- `HostedExecutionCursor`

## Rule For Future Work

Keep Cloudflare boring. If a behavior can live in the local runtime, the hosted
runner should call that runtime rather than adding a web-owned queue, cursor,
or bespoke adoption layer. Logging/debug visibility belongs in the web-owned
runtime log/status ports, not in a second execution protocol.
