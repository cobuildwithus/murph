# Distinguish overdue reminder occurrences

Status: active
Created: 2026-08-24

## Product UX

- Outcome: Murph does not describe an overdue recurring reminder occurrence as healthy scheduler work or tell the member that no action is needed.
- Reaches: private members editing or inspecting an active recurring reminder after an occurrence has passed its deliverable window.
- Proof: focused runtime and assistant-turn regressions distinguish an overdue recurrence from a genuinely in-flight occurrence while preserving the saved reminder and existing scheduler ownership.

## Goal

Keep the occurrence projection introduced by the parent change truthful at the stale-delivery boundary. Only canonical runtime work that is still pending should produce a pending projection; an overdue recurrence whose projection has not advanced should remain explicit and unavailable.

## Scope

- In scope: the hosted automation projection mapping, assistant guidance, typed issue contract, content-free diagnostics, and focused tests.
- Out of scope: scheduler semantics, delivery retry policy, reminder persistence, route ownership, database state, and new lifecycle machinery.

## Tasks

1. Add the existing stale-recurring reason to the typed unavailable projection contract.
2. Keep `runtime_state_pending` as the only healthy pending classification and map a stale recurrence to unavailable.
3. Tell the assistant not to promise automatic recovery or no member action for the stale issue.
4. Prove the distinction through runtime projection, diagnostics, prompt-contract, and scripted-response tests.
5. Run focused tests, package typechecks, privacy and diff inspection, Product UX walkthrough, exact-head reviews, and required PR checks.

## Architecture decision

Reuse the canonical scheduler reason already returned by occurrence projection. Do not add polling, retries, storage, a second scheduler owner, or a recovery queue.

## Verification

- Focused Assistant Runtime projection and telemetry tests.
- Focused Assistant Engine tool-description, prompt, and scripted-turn tests.
- Assistant Engine and Assistant Runtime package typechecks.
- Exact-head ReviewGPT and required GitHub checks.

## Current evidence

- Canonical projection returns `runtime_state_pending` only for pending occurrence, retry, delivery, or running state.
- Canonical projection returns `stale_recurring_occurrence` only after a recurring occurrence is outside the existing deliverable window.
- The parent branch currently collapses both reasons into `pending`, allowing an overdue occurrence to receive healthy in-flight guidance.
- Product UX walkthrough: a real in-flight recurring delivery still reports healthy pending work; the same recurring schedule after its deliverable window reports unavailable with an overdue explanation and no automatic-recovery reassurance; resolved, one-shot, device-triggered, scheduler, and delivery behavior remain unchanged. Verdict: Ready.
- The focused Assistant Runtime file passes all 305 tests, including stale projection, automatic readback, and content-free diagnostics. Assistant Engine prompt/tool contracts pass 96 tests, and the new scripted overdue-member journey passes independently. Both changed packages typecheck.
- Complete first provider-visible request bodies captured through the pinned Codex App Server with identical direct and group reminder fixtures, `gpt-5.6-terra`, low reasoning, production code mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony` grow by 51 tokens and 277 UTF-8 bytes in each route. Direct changes from 27,865 tokens / 127,340 bytes to 27,916 / 127,617; group changes from 23,738 tokens / 108,608 bytes to 23,789 / 108,885. No provider-visible field was excluded from either serialized request. The delta is entirely assembled reminder instructions; the deferred automation tool description is absent from the first request, and all other provider-visible fields are unchanged.
