# Describe Linq tapbacks to the model instead of synthesizing a literal Yes reply

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- A heart/like tapback on an assistant iMessage currently enters reply
  generation as a synthetic inbound message with literal text `Yes.`, plus turn
  context asserting the user "reacted affirmatively". In conversations where
  Murph's message was not a yes/no question, the model is forced to treat an
  acknowledgment as consent (observed in production: a heart on a safety
  warning was read as "yes, this is happening").
- Outcome: the synthetic message and turn context describe the actual reaction
  (heart, like, 👍, matching custom emoji) and instruct the model to interpret
  it in the context of the exact reacted-to message — acknowledgment or
  appreciation by default, agreement only when that message asked a question or
  proposed an action to confirm.

## Success criteria

- No literal `Yes.` synthesis remains in the reaction ingress path.
- The synthetic inbound text names the actual reaction kind and asserts no
  agreement on its own.
- The auto-reply turn context binds interpretation to the exact attested target
  message and permits acknowledgment-weight responses.
- The group-join-offer like-to-consent path and staged group reaction context
  path are byte-for-byte unchanged.
- ARCHITECTURE.md's affirmative-reaction paragraph matches the new behavior.
- All touched-owner tests pass via `pnpm test:diff`.

## Scope

- In scope: `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context.ts`
  (synthetic message text), `packages/assistant-engine/src/assistant/automation/reply.ts`
  (turn-context builder wording/name), tests pinning the old strings in
  `apps/web/test/`, `packages/assistant-engine/test/`,
  `packages/assistant-runtime/test/`, `packages/hosted-execution/test/`,
  ARCHITECTURE.md lines describing the synthetic `Yes.`.
- Out of scope: the `affirmativeReaction` metadata key and its
  contracts/parsers/mailbox-import plumbing (wire shape unchanged); the
  group-join-offer consent reaction path; the silent group reaction-context
  buffer; changelog entries (historical record); wake/attestation/identity
  semantics.

## Constraints

- Technical constraints: keep the reaction event as inbound identity and the
  reacted-to message as reply reference (dedupe/idempotency,
  docs/contracts/00-invariants.md Accepted Work); keep the attested-delivery
  gate and terminal silence for unmatched targets; keep synthetic reactions in
  one-input automation groups.
- Product/process constraints: reactions must not become an implicit consent
  surface (consent fails closed); wording stays neutral, no compliance framing;
  a light acknowledgment response is a sanctioned outcome.

## Risks and mitigations

1. Risk: the model under-reads a genuine "yes" tapback on a direct question
   (e.g. "want me to book it? tap 👍").
   Mitigation: turn context explicitly says to treat the reaction as agreement
   when the target message asked a question or proposed an action.
2. Risk: stale string assertions in tests or docs drift from the new copy.
   Mitigation: repo-wide grep for `Yes.` synthesis, `reacted affirmatively`,
   and `Affirmative reaction target` before finishing; `pnpm test:diff` over
   touched owners.

## Tasks

1. Replace the synthetic `Yes.` text with reaction-descriptive text in
   `webhook-provider-linq-reaction-context.ts`, reusing the existing reaction
   label helper.
2. Rewrite (and rename) `buildAssistantAutoReplyAffirmativeReactionTurnContext`
   in `reply.ts` to describe the reaction and its context-dependent meaning.
3. Update the tests that pin the old strings; keep all gate/identity tests
   green unchanged.
4. Update the ARCHITECTURE.md affirmative-reaction paragraph.
5. Run `pnpm test:diff` over touched paths; parent review; PR + ReviewGPT loop.

## Decisions

- Keep the `affirmativeReaction` source-metadata flag name: it still gates
  which reactions wake an auto-reply (positive-valence only); only the text the
  model sees was wrong. Renaming would churn contracts/parsers/import plumbing
  for no behavior gain.
- Do not add reaction-kind metadata to the engine payload; the synthetic
  message text already carries the reaction kind.

## Verification

- Commands to run: `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context.ts packages/assistant-engine/src/assistant/automation/reply.ts` (plus touched test files).
- Expected outcomes: touched-owner suites green; grep shows no remaining
  literal `Yes.` synthesis or "reacted affirmatively" phrasing outside
  historical changelog text.
