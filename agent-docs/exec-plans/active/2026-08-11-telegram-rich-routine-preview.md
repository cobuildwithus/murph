# Telegram rich routine preview

Status: active, final live presentation approved; completion gates in progress
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Design a clear Telegram rich-message presentation for exercise routines.
- Reuse the strongest presentation patterns and semantic data from the current
  iMessage response cards.
- Give the user a standalone HTML review artifact before production work or a
  pull request proceeds.

## Success criteria

- The review covers every current iMessage card family and its fallback shape.
- Telegram previews show the normal routine, multiple images, compact fallback,
  unavailable media, long text, and narrow-phone states.
- Each exercise has an exact dose, honest duration, and visibly bound image.
- The HTML is self-contained, responsive, and easy to inspect locally.
- No PR is opened before explicit user approval of the visual direction.

## Scope

- In scope: current card inventory, Telegram presentation design, standalone
  HTML previews, and the smallest implementation plan derived from approval.
- Out of scope: callback-button workflows, a second queue, and new persisted
  presentation state.

## Constraints

- Preserve existing outbox, retry, delivery-authority, and card ownership.
- Do not add persisted product state for presentation.
- Use the current Murph warm-desert design language.
- Keep ordinary text and media-group delivery as a truthful fallback.

## Tasks

1. [x] Inventory current iMessage cards and fallback presentations.
2. [x] Define the smallest shared semantic presentation shape.
3. [x] Build the standalone Telegram HTML preview set.
4. [x] Verify desktop and phone rendering, then request visual approval.
5. [x] After approval, implement production delivery and focused tests.
6. [x] Route hosted rich delivery through the existing provider-entry owner and
   remove the local rich retry loop.
7. [x] Make fallback cardinality and catalog image provenance exact after the
   preliminary specialist review.
8. [ ] Complete the final ReviewGPT, CI, commit, and PR gates.
9. [x] Keep routine meaning channel-neutral, move timing consistency to agent
   guidance, and document channel-native presentation across Telegram and
   iMessage without adding a shared renderer or delivery layer.

## Decisions

- Treat the preview as product UI shown inside a Telegram conversation.
- The user approved the preview before production work began.
- Telegram Bot API 10.2 supports `sendRichMessage`, tables, details, and
  slideshows. Use those native blocks instead of a generated card image.
- Keep one response card as one outbox effect and one provider request.
- Use a dedicated routine-card tool so both Codex tool schemas remain below the
  5,000-byte compaction limit. Both tools create the same response-card effect.
- Omit inline buttons until Murph has an explicit callback workflow.
- A definitive non-retryable 4xx can fall back to deterministic text. Ambiguous
  or retryable failure must not start a second provider request.
- Every rich-card text fallback must fit one Telegram message before rich
  provider entry.
- Image provenance uses the returned exercise ID plus the image's one-based
  position in the returned catalog array.
- Offer the routine-card tool only on private Telegram. Linq/iMessage keeps the
  existing catalog response-media path for visual movement guidance.
- Treat timing as model-authored presentation. Prompt the agent to compare the
  stated duration with the visible routine instead of adding runtime arithmetic.
- Review useful structured UI across both Telegram and iMessage. Reuse meaning,
  not provider UI; each channel keeps its own cards, media, and delivery owner.
- Keep routine cards compact when collapsed. Put each exercise's instructions
  and images inside its own details block instead of repeating the routine in a
  summary table and one global caption.
- Present nutrition goals as one compact table with short semantic statuses.
  Keep the image and goals useful without repeating sentence-shaped labels.
- Keep the local manual-preview recipient in ignored environment state. Commit
  only the variable name and the safe opt-in preview procedure. When configured,
  user-facing Telegram presentation work sends representative live samples
  before final review; backend-only work does not.
- Keep the product owner's approved prompt-authored timing model. Do not restore
  a runtime arithmetic validator. The prompt compares the stated duration with
  the visible work before attachment.
- Keep the approved compact routine layout without a visible shared slideshow
  caption. Telegram supports one caption for the whole slideshow, not a caption
  that changes with each image. General movement instructions remain text, while
  exact catalog alt and step data stay frozen for provenance and future native
  presentation work.
- Treat only a valid Telegram `ok: false` envelope as proven non-acceptance.
  Transport failure or any response without a valid success or rejection
  envelope is terminal ambiguity and must not release the effect for replay.
- Apply that invalid-envelope rule to text, photo, voice, and rich sends. All
  four operations are non-idempotent and use the existing shared outcome owner.

## Verification

- The standalone file renders without browser errors.
- A 390 px viewport has no page-level horizontal overflow.
- Desktop and phone screenshots were inspected locally.
- The preview contains seven Telegram phone states: rich routine, text
  fallback, captioned album, nutrition, compact workout table, unavailable
  media, and a long routine.
- Fable confirmed the information direction and single-effect constraint. Its
  Telegram capability concern relied on older API behavior and was superseded
  by the current official Bot API documentation.
- Impeccable found low design slop. Its valid findings corrected the nutrition
  percentage and added accessible names to fallback images.
- Focused typechecks pass for contracts, operator-config, assistant-engine, and
  the Cloudflare runner.
- Operator card tests pass: 13 tests, including the maximum rich-message size.
- Assistant channel, card-tool, skill, and turn-planning tests pass: 174 tests,
  with 6 existing skips.
- Cloudflare provider-egress conformance and intercept tests pass: 247 tests.
- Agent docs drift check passes.
- `git diff --check` passes.
- The user approved the final live Telegram routine, nutrition, and compact
  table presentation after two focused iteration rounds.
- Final ReviewGPT round 4 found that the rich adapter preserved the wrong error
  code after an ambiguous provider response. Focused correction tests prove 79
  channel-runtime cases and the later outbox drain makes no second request.
- Final ReviewGPT round 5 confirmed the duplicate correction and found that the
  shared text, photo, and voice impact was not disclosed or directly tested.
  Focused proof now covers all four Telegram send operations and the old-Worker
  policy-response rollout seam.
