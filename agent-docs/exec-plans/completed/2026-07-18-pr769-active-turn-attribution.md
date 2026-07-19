# PR 769 active-turn attribution

## Goal

Adjudicate the ReviewGPT finding in PR 769 against the real group-turn
admission path and preserve the smallest correct attribution boundary.

If the existing actor-scoped turn invariant already prevents another group
participant from entering the active turn, keep scanner-scoped attribution and
add only the durable proof needed to protect that invariant. Add no new state
owner, cache, retry, compatibility path, filesystem read, or Web read.

## Invariants

- The model-facing shared-read request remains projection-scopes-only.
- A Linq group turn is actor-scoped: import derives `actorId` from the same
  sender value used for the prompt handle, initial batching splits on actor
  change, and pre-provider plus live admission stop at a foreign actor.
- Attribution authority remains bound to the scanner-selected durable
  operation contexts; active steering cannot widen it to another participant.
- Ambiguous routes, wrong threads, direct chats, email, SMS, scheduled work,
  notifications, and detached execution remain handle-free.
- The existing single lazy Web `read_shared` request, blind-index matching,
  model serializer, and unchanged `read_current` wire remain intact.
- Handles remain deduplicated and bounded; forged model handles are discarded.

## Work plan

1. Prove initial batching, pre-provider admission, and live steering against
   sender-derived group actor identity.
2. Reject any proposed authority expansion that depends on an unreachable
   multi-participant turn or weakens actor isolation.
3. Add a narrow sender-to-actor regression assertion and document why the
   existing scanner-scoped attribution is complete for a group turn.
4. Run focused verification, commit and push the proof-only head, then rerun
   CI and ReviewGPT with the finding disposition.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-turn-input.test.ts` in `packages/assistant-runtime`: 84 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-runtime.test.ts -t "keeps a foreign group actor and later same-actor input pending"` in `packages/assistant-engine`: the focused actor-boundary regression passed.
- `pnpm typecheck` in `packages/assistant-runtime`: passed.
- `git diff --check`: passed.
- Parent scope-and-shape review confirmed that the follow-up changes only docs
  and one sender-derived actor assertion; no runtime path or contract changed.
- Coverage-write review reported no findings. It confirmed that initial
  batching, pre-provider admission, live steering, and ordered pending-input
  behavior compositionally enforce one actor per turn; all four isolated
  engine proofs passed.

Status: completed
Updated: 2026-07-19
Completed: 2026-07-19
