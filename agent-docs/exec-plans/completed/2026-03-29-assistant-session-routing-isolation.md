# 2026-03-29 assistant session routing isolation

## Goal

- Make assistant session lookup and routing fail closed when a saved session is asked to rebind to a different channel, identity, participant, or thread, while preserving the existing one-send explicit target override path and outbound canonical-target normalization.

## Scope

- `packages/cli/src/assistant/{bindings.ts,store/persistence.ts}`
- `packages/assistantd/src/http.ts`
- targeted `packages/{cli,assistantd}/test/{assistant-state.test.ts,assistant-channel.test.ts,http.test.ts}`
- `ARCHITECTURE.md` only if a behavior-level assistant routing note needs to move with the patch
- `agent-docs/exec-plans/active/{2026-03-29-assistant-session-routing-isolation.md,COORDINATION_LEDGER.md}`

## Findings

- `resolveAssistantSession()` currently persists binding patches after lookup, even when the saved session already has a different scoped audience.
- `deliverAssistantMessage()` inherits that behavior because it resolves the session first, so a resumed session can be silently repointed to a new thread or audience instead of using the existing explicit target override path.
- `resolveAssistantConversationKey()` still falls back to actor-only scoping when a conversation is explicitly marked group and has no thread id, which is broader than the available routing evidence.
- `assistantd` validates that nested `conversation` is an object, but it does not yet enforce the canonical nested conversation-ref shape or reject legacy or non-canonical nested routing fields.

## Plan

1. Add a small binding-isolation helper in `bindings.ts` that flags any attempt to clear or replace an already-bound routing field during session lookup while still allowing monotonic enrichment from `null` to a concrete value.
2. Enforce that check in assistant session persistence so lookup-by-session-id, alias, or conversation key cannot silently rebind a saved session; keep alias renames and outbound explicit target overrides untouched.
3. Tighten conversation-key derivation so actor-only fallback is not used for explicitly group-scoped conversations with no thread id.
4. Validate canonical nested conversation-ref fields in `assistantd` and reject legacy nested `actorId` or `sourceThreadId` or `threadIsDirect` payloads.
5. Add focused regressions for session conflict errors, safe enrichment, group-without-thread actor-key suppression, delivery-time reroute rejection, and daemon request validation.

## Verification

- Focused:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-channel.test.ts packages/assistantd/test/http.test.ts --no-coverage --maxWorkers 1`
- Repo baseline:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
