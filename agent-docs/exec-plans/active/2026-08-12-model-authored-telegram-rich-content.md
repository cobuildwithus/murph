# Model-authored Telegram rich content

Status: active
Created: 2026-08-12
Updated: 2026-08-13

## Goal

- Let Murph author a bounded Telegram Rich Message when structured presentation improves the complete answer.
- Cover structured guidance that does not fit the existing nutrition, compact-table, or exercise-routine cards.
- Preserve those three approved cards and use their presentation choices as model-facing examples.

## Success criteria

- Private Telegram turns can attach one validated model-authored Rich Message.
- Non-catalog routines, checklists, schedules, comparisons, and multi-section summaries can use the new path when structure helps.
- Short answers, confirmations, casual chat, and incomplete card answers stay as ordinary text.
- Existing semantic cards keep their current schemas, renderers, and tool priority.
- The accepted HTML subset has bounded length, nesting, tables, and attributes, with no links or remote media.
- Runtime derives one complete text fallback from the validated HTML and uses the existing response-card outbox and Telegram delivery owner.
- Focused deterministic and real-model tests prove positive, negative, fallback, and channel-isolation journeys.

## Evidence

- The reported structured guidance used styled plain text because no current card could represent that content shape.
- The generic compact-table card cannot carry detailed step instructions within its cell bounds.
- The exercise-routine card requires catalog-backed movements and images.
- Prior Telegram card iteration established compact sections, optional details, visible safety guidance, real tables, no repeated summary, and no duplicate final text.

## Tasks

1. [x] Add a bounded Telegram rich-content card contract and deterministic text fallback.
2. [x] Add a private-Telegram-only authoring tool with Telegram rules and three approved presentation examples.
3. [x] Preserve semantic-card priority and route the new card through the existing response-card effect.
4. [x] Add contract, tool, planning, rendering, delivery, prompt, and real-model regression proof.
5. [x] Update durable product, architecture, security, reliability, and verification guidance.
6. [ ] Run focused checks, inspect the full diff, push the candidate, complete required reviews and CI, then open the PR.

## Decisions

- Use user-approved option 3: the model authors constrained Telegram Rich HTML.
- Keep existing semantic cards unchanged and prefer them when their contracts fit.
- Accept presentation-only HTML. Reject links, media, maps, custom emoji, and provider-side fetches.
- Derive fallback text in trusted code. Do not ask the model to author a second copy.
- Reuse the existing response-card, outbox, retry, and provider-entry owners.

## Review evidence

- Preliminary specialists found that soft semantic-card priority let generic
  HTML compete with nutrition and other owning cards. The corrected prompt
  makes those owners exclusive and keeps all three approved cards as routing
  examples, not HTML templates.
- Preliminary specialists found that rejecting anchor tags did not stop
  Telegram from creating clickable entities from plain text. The final review
  showed that a parser regex still split ownership. The corrected provider
  projection sets `skip_entity_detection` only for the generic card and removes
  the partial text detector. Existing semantic cards keep their current entity
  behavior.
- A later final review found that definitive Rich Message rejection restored
  automatic Telegram entities in the ordinary text fallback. The current
  provider adapter carries the generic card policy into that fallback and sends
  its full visible text as one explicit `pre` entity. This keeps URLs, emails,
  mentions, hashtags, commands, and phone numbers non-interactive. Monospace is
  accepted as the rare recovery experience. The existing delivery and fallback
  owners remain unchanged.
- The completed retrospective accepts one provider-boundary entity-policy owner
  for both rich and fallback representations. It rejects another parser-side
  detector, queue, retry loop, state owner, or fallback copy. The disclosed
  missing live canary remains accepted, with provider-boundary tests and a
  post-deploy smoke check required instead.
- Competitive real-model coverage now exposes the generic and semantic tools
  together for compact-table and catalog-routine selection. Local execution
  remains at the expected provider-credential gate.
- A live Telegram canary is not available in the current local environment.
  Mocked provider-boundary proof covers exact Rich HTML, definitive rejection,
  one fallback, and ambiguous-acceptance duplicate suppression.
