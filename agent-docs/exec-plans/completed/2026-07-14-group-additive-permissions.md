# Group additive permissions

## Goal

Make group permission additions feel like consent to a new scope, not another
group join. Existing members should be able to like the server-owned offer to
opt in, while the first-party page remains the customize path.

## Success criteria

- Additive permission requests in an existing group default to
  `murph.group action="post_join_offer"`, not a fresh join link.
- Offer copy starts with `Like this message`, states the exact consent action,
  and does not tell existing members to join or rejoin the group.
- The offer still contains the exact server-filled share scope and one
  first-party customize link; liking adds only that disclosed snapshot.
- Prompt regressions cover the generic tool contract plus group-chat and
  group-challenge skill guidance.

## Working set

- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/skills/group-chat/SKILL.md`
- `packages/assistant-engine/skills/group-challenge/SKILL.md`
- `packages/assistant-engine/test/assistant-capability-offers-prompt.test.ts`
- `packages/assistant-engine/test/assistant-codex-group-tool.test.ts`
- `packages/assistant-engine/test/assistant-skill-assets.test.ts`
- `agent-docs/PRODUCT_SENSE.md`

The stable hosted-group guidance requires one aligned correction in
`buildAssistantHostedGroupGuidanceText`. Other active lanes touch separate
symbols in the same prompt file; keep this edit confined to the hosted-group
section and reconcile their changes from `main` before handoff.

## Persisted-state classification

No persisted state, schema, authority, runtime, or provider contract changes.
This is a prompt-primary correction over the existing server-owned group offer.

## Verification plan

- Focused assistant-engine Vitest for the group tool and skill assets.
- Assistant-engine typecheck or the truthful scoped diff lane selected by the
  verification router.
- Required prompt-review subagent using current official OpenAI prompt
  guidance, followed by parent final diff and assembled-prompt review.
- Close the plan with `scripts/finish-task`, push the branch, open a PR, and
  verify required CI plus mergeability. ReviewGPT is not required for this
  prompt-primary change.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
