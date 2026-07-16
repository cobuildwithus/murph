# Require complete provider turn results

## Goal

Hard-cut the successful Codex provider-turn result contract so every result carries an explicit capability-free transcript value and every final or preceding response carries the accepted-input delivery-context ordinal that owns it.

Success means the producer always emits those values, the adapter preserves them, the local service no longer invents transcript or first-context fallbacks, invalid or out-of-range ordinals still fail closed, and focused fixtures model the complete result contract truthfully.

## Scope

In scope:

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- The focused provider/local-service test files registered in the coordination ledger, including two shared typed-fixture owners required by the compile-time hard cut

Out of scope:

- Other optional provider-result fields
- Persisted data, wire schemas, or deployment compatibility machinery
- Changes to no-reply, response-media, or capability transcript semantics

## Constraints

- Preserve explicit `string | null` transcript semantics; media-only delivery uses an empty semantic transcript and explicit no-reply remains transcript-free.
- Preserve final-reply failure on an invalid or out-of-range ordinal.
- Preserve preceding-segment diagnosis-and-skip behavior for an invalid or out-of-range ordinal.
- Keep the change within the existing producer, adapter, and consumer ownership boundary; add no compatibility shim or new abstraction.
- Preserve unrelated working-tree and coordination-ledger edits.

## Plan

1. Require transcript and delivery-ordinal fields in the provider result types.
2. Emit and directly map complete final and preceding response values.
3. Delete the local-service transcript and first-context compatibility fallbacks.
4. Update focused fixtures and assertions to describe the actual successful-result contract.
5. Run the focused six-file suite, stale-pattern searches, diff validation, and the truthful diff-scoped test command.

## State

- Status: ready for parent coverage audit
- Updated: 2026-07-15
- Current step: implementation and focused verification are complete; parent audit, commit, PR, and ReviewGPT remain.
- Verification: all six focused runtime files and the assistant-engine typecheck pass. Diff-scoped guards and affected typechecks pass; affected tests are blocked only by persistent unrelated baseline failures in untouched setup-cli and assistant-runtime owners.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
