# Agent Reliability Audit Hardening

## Goal

Audit the assistant/inbox runtime against current agent-framework robustness patterns, then land a narrow runtime hardening patch that improves recovery from connector crashes, stalled provider calls, and transient outbound transport failures without changing Healthy Bob's trust boundaries or persistence model.

## Scope

- `packages/inboxd/src/kernel/daemon.ts`
- `packages/parsers/src/inboxd/pipeline.ts`
- `packages/cli/src/inbox-app/{runtime,types}.ts`
- `packages/cli/src/{chat-provider,linq-runtime,agentmail-runtime}.ts`
- focused `packages/inboxd/test/connectors-daemon.test.ts`
- focused `packages/cli/test/{assistant-provider,assistant-channel,inbox-cli}.test.ts`
- runtime docs updated to match the new reliability behavior

## Non-Goals

- Do not rewrite connector-specific polling semantics for Telegram, email, iMessage, or Linq.
- Do not change canonical inbox persistence contracts, session binding semantics, or hosted/local trust boundaries.
- Do not introduce a new durable workflow engine in this patch; keep architectural recommendations separate from the implementation delta.

## Invariants

- Abort signals must still stop foreground runs promptly.
- `continueOnConnectorFailure` must still keep healthy sibling connectors alive.
- Existing external APIs for assistant delivery and inbox configuration must remain source-compatible.
- New retry behavior must stay bounded and only retry clearly transient or restartable failures.

## Plan

1. Add daemon-level connector restart/backoff support so isolated connector failures do not silently disable a source for the rest of a long-running run.
2. Thread restart policy defaults through parser + CLI runtime entrypoints for foreground daemon/assistant automation runs.
3. Harden the OpenAI-compatible provider path with explicit timeout, retry, and abort propagation.
4. Add a small resilient HTTP transport layer for Linq and AgentMail with bounded retries, timeout handling, and transient-error classification.
5. Add focused regression coverage, then run the available verification commands and record blockers precisely if the existing worktree prevents a clean pass.

## Verification

- `pnpm exec vitest run --no-coverage packages/inboxd/test/connectors-daemon.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-channel.test.ts packages/cli/test/inbox-cli.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-03-26
Completed: 2026-03-26
