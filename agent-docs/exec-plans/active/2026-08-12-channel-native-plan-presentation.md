# Channel-native plan presentation

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Use the strongest existing channel-native presentation for structured plans.
- Prevent a full exercise or training plan from silently degrading to long plain text when an owned card or media presentation is available.
- Keep one semantic answer and one delivery owner across Telegram, iMessage, and other supported channels.

## Success criteria

- A private Telegram exercise routine uses the exercise routine Rich Message when that card can fully answer the request.
- A channel with owned response cards or response media uses them for eligible structured plans instead of recreating the same result as long plain text.
- A channel without an owned structured presentation keeps one concise, truthful text response.
- Existing safety, provenance, outbox, fallback, and delivery-authority rules remain unchanged.
- Focused tests prove the prompt and tool contracts for direct and scheduled turns.

## Scope

- In scope: assistant presentation guidance, exercise-catalog presentation rules, focused prompt/tool tests, and matching durable product guidance.
- Out of scope: new card schemas, new provider APIs, new persisted presentation state, new delivery queues, or changes to member automations.

## Tasks

1. [x] Inventory current card and media availability by channel and turn type.
2. [x] Strengthen the owning presentation rules without changing delivery authority.
3. [x] Add focused direct and scheduled-turn proof.
4. [ ] Run scoped verification and inspect the complete diff.
5. [ ] Push the candidate, open the PR, and complete the specialist ReviewGPT and CI gates.

## Decisions

- Reuse existing semantic cards, response media, channel adapters, and outbox ownership.
- Do not parse model-authored text in the runtime or add a second model retry.
- Keep safety-critical details in the owned card or concise text fallback.

## Verification log

- Focused Assistant Engine tests pass after specialist remediation: seven files, 208 tests passed and six credential-gated tests skipped.
- Assistant Engine typecheck passes.
- The prompt-size regression passes without raising its fixed limit.
- Changelog generation and `git diff --check` pass.
- Preliminary ReviewGPT found that response media cannot replace routine order, dose, timing, cues, or safety. The corrected contract reserves text replacement for complete cards and keeps concise semantic text with response media.
- Added opt-in real-model journeys for attended Telegram, scheduled Telegram, and attended Linq routine presentation. Local execution reached the credential gate and stopped because `OPENAI_API_KEY` is unavailable; the exact test remains available to credentialed CI or an operator lane.
