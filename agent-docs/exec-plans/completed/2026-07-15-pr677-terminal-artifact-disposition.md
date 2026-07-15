# PR 677 Terminal Artifact Disposition

## Goal

Resolve the ReviewGPT round-four retrospective by assigning artifact-read
failure disposition to existing owners so neither transient infrastructure
failure nor permanently unreadable persisted content can brick foreground
reply authority or silently discard valid canonical state.

## Retrospective Decision

- Original requirement: recovery must never checkpoint partial receipt replay
  or indefinitely withhold a reply to durably accepted current input.
- Round three proved that treating every artifact exception as corrupt input can
  discard a valid receipt during a transient outage. Round four proved the
  symmetric flaw: treating every exception as retryable can loop forever on a
  permanently malformed encrypted object.
- Root mechanism: the artifact port exposes only bytes, missing, or an untyped
  exception even though the encrypted R2 reader knows whether persisted content
  is deterministically unreadable.
- Decision: keep the authoritative snapshot and existing invocation retry as the
  only state owners. The encrypted R2 reader marks deterministic envelope or
  decryption failure; the artifact HTTP adapter transports that disposition;
  the existing runtime artifact port exposes it; receipt recovery retries only
  the explicitly retryable case and rejects the terminal case.
- Add no persisted retry count, repair record, queue, service, lifecycle,
  reconciliation loop, compatibility path, or status owner.

## Working Set

- `apps/cloudflare/src/crypto.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/runtime-platform/artifact-store.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime/canonical-write-receipt-log.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- focused Cloudflare, runtime-state boundary, and assistant-runtime tests
- `agent-docs/references/hosted-runtime-protocol.md`

## Verification Plan

- Prove one-shot transport or 503 failure preserves the original receipt ref,
  clears partial local effects, and succeeds on the next invocation.
- Prove a persistent malformed-envelope/decryption failure is classified
  terminal, rejects the active receipt fingerprint, restores the snapshot, and
  reaches mailbox and assistant admission on that invocation.
- Prove cancellation identity and deterministic missing/malformed receipt
  behavior remain unchanged.
- Run focused tests, affected typechecks/coverage, the required coverage-write
  audit, `pnpm test:diff`, CI, and final ReviewGPT round five.

## Outcome

- Deleted the receipt-specific catch-all artifact wrapper from round four.
- The existing encrypted R2 reader now marks only deterministic persisted
  envelope/decryption failures terminal; R2, body-read, key-resolution request,
  and service failures remain retryable.
- The existing artifact route and runtime port carry that disposition without
  persisted retry state. Receipt recovery retries only the explicit retryable
  case; terminal failures follow the existing reject-and-continue path.
- Production-shaped tests cover malformed encrypted content through reader,
  route, platform, and assistant boundaries, plus retryable transport failures
  at log, receipt, and second-payload reads after partial mutation.
- The required coverage-write audit found no unresolved gap. Assistant-runtime
  coverage passed with 1,666 tests and 2 skips; Cloudflare passed 1,822 tests;
  affected typechecks and `pnpm test:diff` passed on the exact final diff.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
