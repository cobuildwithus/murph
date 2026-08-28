# Restore participant-target group consultation

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Restore the existing promise that a member can target a joined group by its
  participants when asking or handing off from a private Murph conversation.

## Success criteria

- The published `group_consult` schemas accept `participantTarget` only for
  `ask` and `handoff`, while preserving each action's current required fields.
- Deterministic tests prove the action-specific schema and parser boundary.
- One production-derived real-Codex journey selects the participant-targeted
  group tool call with exact arguments and no membership enumeration.
- Focused tests, typecheck, ReviewGPT, and exact-head required CI pass.

## Scope

- In scope: the existing action-specific group-consult schema, focused boundary
  coverage, one synthetic live-model journey, and replacement-PR evidence.
- Out of scope: new group actions, target-resolution rules, membership lookup,
  delivery behavior, authorization changes, state, or dependencies.

## Constraints

- Technical constraints: reuse `MURPH_GROUP_TOOL_PROPERTIES.participantTarget`
  and the existing Web-owned target resolution; do not widen other actions.
- Product/process constraints: treat this as a Product UX Patch and apply the
  Murph-assistant verification workflow before updating the PR candidate.

## Risks and mitigations

1. Risk: the correction admits participant targeting on an unintended action.
   Mitigation: list it only in the two action-property records and assert every
   branch's exact keys.
2. Risk: schema proof passes while the model ignores the available argument.
   Mitigation: run one focused production-derived real-Codex journey and review
   the actual call and member-visible reply.

## Tasks

1. Prove the default-branch regression and identify the introducing contract
   mismatch.
2. Restore the smallest action-specific schema entries and deterministic proof.
3. Add and run one focused real-Codex journey.
4. Run focused verification, ReviewGPT, and exact-head CI; update and merge the
   replacement PR, then close the superseded PR and retire both worktrees.

## Decisions

- Keep `participantTarget` optional for `ask` and `handoff`, matching the
  existing prompt, parser, family root-key contract, and host resolver.
- Do not paper over the failure by removing the expected key from the test.
- Clarify that `participantCount` counts other people only and subtracts an
  explicitly included requester/self entry.
- Keep accepted handoff language truthful at the deferred-tool boundary:
  accepted means queued, never passed, sent, delivered, told, shared, or posted.

## Product UX walkthrough

- A private member names one other participant: Murph makes one direct handoff,
  does not enumerate memberships, and reports the result as queued.
- A private member gives a total chat size and two other participants: Murph
  sends both names with a count of two and does not include the requester.
- A private member explicitly lists themself with two other participants:
  Murph omits the requester and sends only the other two names.
- Existing exact-title targeting, host resolution, authorization, and delivery
  behavior remain unchanged.

## Verification

- Focused group-tool and description contracts: 123 tests passed.
- Assistant Engine typecheck: passed.
- Changelog archive rendering: 9 tests passed.
- Focused live journey: `gpt-5.6-terra`, local subscription, three synthetic
  participant-description cases, one direct handoff each, no membership lookup,
  requester excluded, truthful queued replies; reply review verdict `Ready`.
- Remaining: exact-head ReviewGPT/CI and current-base merge-tree proof.
