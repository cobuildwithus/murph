# voice-only-voice-memo-guidance

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Prevent voice-memo replies from automatically duplicating their spoken
  content as an adjacent text message.

## Success criteria

- The voice-memo tool contract says final response text is optional.
- Voice-only requests and owning voice-only flows explicitly leave final text
  empty.
- Accompanying text is reserved for distinct necessary information or an
  explicit owning-flow requirement; explicit requests for both audio and text
  remain authoritative.
- Voice-only completion uses an empty final assistant message instead of
  `murph.finish_without_reply`, which is incompatible with attached media.
- Voice-only Linq/iMessage replies do not select a native reply target, whose
  transport contract requires accompanying text.
- Focused prompt-contract tests pass.

## Scope

- In scope: the model-visible `murph.generate_voice_memo` tool description and
  its focused contract test.
- Out of scope: delivery-adapter behavior, semantic runtime deduplication, and
  changes to flows that intentionally combine distinct text with audio.

## Constraints

- Technical constraints: keep the delivery layer's existing support for
  intentional text-plus-voice responses and transcript fallback; preserve
  Linq's text requirement when native reply targeting is explicitly used.
- Product/process constraints: preserve the onboarding skill's existing
  voice-only labs-question rule and avoid encoding confidential incident text
  in tests or prompts.

## Risks and mitigations

1. Risk: broad wording could suppress useful companion text.
   Mitigation: allow text when it adds distinct necessary information or the
   owning flow explicitly requires it.
2. Risk: empty-text iMessage media cannot carry native reply targeting.
   Mitigation: tell the model not to select a native reply target for
   voice-only Linq/iMessage responses.

## Tasks

1. Tighten the voice-memo tool's modality guidance.
2. Update focused prompt-contract coverage.
3. Run the relevant test and typecheck.
4. Complete product and preliminary prompt/coverage reviews, then finish the
   PR workflow.

## Decisions

- Keep this as a prompt-contract correction; do not add delivery-time semantic
  deduplication because intentional mixed-modality replies remain supported.
- Accept the product-review finding that voice-only Linq/iMessage responses
  must avoid native reply targeting; the existing delivery rejection remains
  the runtime invariant.
- Accept all preliminary specialist findings: preserve explicit user requests
  for both modalities, make empty-final-message completion unambiguous, and
  assert the complete decision sentences instead of isolated fragments.

## Verification

- Focused Vitest for the prompt contract, existing Linq voice-only rejection,
  empty-final-message media delivery, and the incompatible no-reply sequence:
  3 files passed; 4 tests passed and 265 skipped.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- Initial product-experience review found the native-reply-target conflict.
  The prompt caveat and contract assertion implement the accepted smallest
  correction; the fresh remediation review returned `NO FINDINGS`.
- The fresh post-specialist product review also returned `NO FINDINGS`. It
  records that current-model, production-faithful end-to-end adherence remains
  unproven by the static and mocked focused checks.
- Exact provider-input delta for the changed JSON-string tool description,
  measured with `gpt-tokenizer` 3.4.0 `o200k_harmony`: +106 tokens and +586
  UTF-8 bytes in a voice-enabled initial turn.
Completed: 2026-07-29
