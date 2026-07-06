# Group Session Routing Rebind

## Problem

A hosted group chat stopped getting replies and the runtime fell into a
permanent ~30s wake loop (observed for 16+ hours across two group containers).
Root cause: when a group's routed audience shape drifts — the active speaker
changes, or the direct/group flag flips because the assistant is removed and
re-added — `persistResolvedSession` throws `ASSISTANT_SESSION_ROUTING_CONFLICT`.
Inbound messages resolve a session by conversation-key, and that path never
allowed a binding rebind, so every reply attempt failed, the mailbox input
stayed pending, the consume watermark never advanced, and the wake loop spun
forever without replying or self-healing.

## Decision

Allow a binding rebind when the session was located by `conversation-key`.

A conversation-key match is located BY the routing boundary itself: channel,
identity, and the thread-or-actor scope are all encoded in the lookup key, so a
match already proves those are equal. The only isolation fields that can still
differ on that path are within-conversation drift (a group's active speaker, or
`threadIsDirect` flipping as members change). That drift must update the binding,
never fail the reply.

Do not touch `getAssistantBindingIsolationConflicts` (the pure reporter stays
correct) and do not change the `alias` or `session-id` paths: an explicit
session-id resume still requires opt-in `allowBindingRebind`, and alias resumes
still fail closed, because there the caller supplies the identifier and could be
retargeting a genuinely different audience.

No new state, queue, retry cap, or dead-letter mechanism. The root-cause fix
removes the failure that produced the loop; the loop clears by construction once
the reply succeeds and the input is consumed.

## Verified Against Current Code

- `packages/assistant-engine/src/assistant/bindings.ts` — isolation fields are
  `channel | identityId | actorId | threadId | threadIsDirect`; the conversation
  key is `channel | identity | (thread|actor)` scope, so channel/identity/scope
  are equal by construction on any conversation-key match.
- `packages/assistant-engine/src/assistant/store.ts` — inbound messages with no
  sessionId/alias resolve via the conversation-key branch (`lookupSource:
  'conversation-key'`).
- `packages/assistant-engine/src/assistant/store/persistence.ts` — the throw
  gate is the only place that rejected the rebind; `synchronizeAssistantIndexes`
  already reconciles the index if the derived key changes.
- Existing `ASSISTANT_SESSION_ROUTING_CONFLICT` tests only cover the `session-id`
  and `alias` paths (packages/cli assistant-state / assistant-channel,
  assistant-engine infra-final-coverage); none assert the conversation-key path
  throws.

## Files

- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/assistant-engine/test/assistant-session-resolution-store.test.ts`

## Verification

- New regression tests: group speaker + directness drift rebinds within the same
  session (was the wedge); session-id retarget still throws.
- `pnpm --dir packages/assistant-engine typecheck` clean.
- Full assistant-engine suite green; packages/cli conflict suites green.

## Invariants To Preserve

- Replies to a current inbound message keep an authorized success path
  (`docs/contracts/00-invariants.md` § Product-Critical Flow Preservation).
- Cross-audience isolation on explicit `alias` / `session-id` resumes is
  unchanged.

## Deployment

Assistant-engine ships in both web (Vercel) and the Cloudflare hosted runner.
The wedge and self-heal live in the hosted runner, so the fix only takes effect
once the Cloudflare hosted runtime is deployed. On deploy, the next wake of a
stuck container rebinds, replies, consumes the pending input, and the loop ends.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
