# Telegram routine card repair

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Make private Telegram movement routines use the existing exercise routine Rich Message.
- Cover first presentation, resend, and presentation-repair requests from the current conversation.
- Prevent Markdown or formatted plain text from being treated as a Rich Message substitute.

## Success criteria

- A private Telegram request to resend or improve an existing routine calls `murph.attach_exercise_routine_card` when the card can carry the complete answer.
- The card replaces final text and uses the existing exercise catalog and delivery path.
- Channels without that card keep their existing media or concise text fallback.
- No new renderer, state owner, delivery branch, or text parser is added.
- Focused prompt tests and a production-shaped real-model scenario cover the reported journey.

## Evidence

- Runtime evidence showed that the routine card was available but was not selected on a presentation-repair turn.
- The existing real-model test asks Murph to teach a new routine directly. It does not cover a resend or presentation-repair request against an existing routine in conversation history.
- The exercise routine tool describes a movement-instruction turn, but it does not explicitly classify resend, restyle, or `rich text` follow-ups as the same card-owned turn.

## Tasks

1. [x] Add the missing resend and presentation-repair rule at the existing prompt and tool boundary.
2. [x] Add deterministic composed-prompt and tool-description regression proof.
3. [x] Add a production-shaped real-model journey for a prior routine followed by a resend or presentation-repair request.
4. [x] Run focused verification and inspect the complete diff.
5. [x] Push the candidate, complete specialist review and exact-head CI, and prepare the clean merge.

## Decisions

- Reuse the existing Telegram exercise routine card and delivery owner.
- Do not add a parser for model-authored text or a second model call.
- Treat Markdown as a text fallback, not a successful Rich Message presentation.
Completed: 2026-08-12
