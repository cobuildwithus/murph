# Distinguish overdue reminder occurrences

Status: active
Created: 2026-08-24

## Product UX

- Outcome: Murph does not describe an overdue recurring reminder occurrence as healthy scheduler work or tell the member that no action is needed.
- Reaches: private members editing or inspecting an active recurring reminder after an occurrence has passed its deliverable window, plus eligible non-email groups inspecting the room-owned reminder.
- Proof: focused runtime and assistant-turn regressions distinguish an overdue recurrence from a genuinely in-flight occurrence, keep timezone-uncertain timing non-authoritative, confirm a stale edit without an extra inspection, and preserve neutral group presentation.

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
6. Keep stale classification producer-owned: emit the stale issue only when no other projection issue makes the timing basis non-authoritative.

## Architecture decision

Reuse the canonical scheduler reason already returned by occurrence projection. Do not add polling, retries, storage, a second scheduler owner, or a recovery queue.

When multiple projection problems coexist, keep the underlying uncertainty and omit the derived stale conclusion. This preserves one truthful response owner instead of adding prompt precedence rules for contradictory states.

## Verification

- Focused Assistant Runtime projection and telemetry tests.
- Focused Assistant Engine tool-description, prompt, and scripted-turn tests.
- Assistant Engine and Assistant Runtime package typechecks.
- Exact-head ReviewGPT and required GitHub checks.

## Current evidence

- Canonical projection returns `runtime_state_pending` only for pending occurrence, retry, delivery, or running state.
- Canonical projection returns `stale_recurring_occurrence` only after a recurring occurrence is outside the existing deliverable window.
- The parent branch currently collapses both reasons into `pending`, allowing an overdue occurrence to receive healthy in-flight guidance.
- Product UX walkthrough: a real in-flight recurring delivery still reports healthy pending work; an authoritative stale recurrence reports unavailable with an overdue explanation in direct inspection, direct edit, and neutral group inspection; an implicit-timezone recurrence with an unverified fallback reports only timing uncertainty; resolved, one-shot, device-triggered, scheduler, and delivery behavior remain unchanged. Verdict: Ready.
- The accepted review correction keeps `stale_recurring_occurrence` out of any response that already carries another projection issue, so the producer cannot expose a derived overdue claim alongside an unverified timing basis. This is one owner-boundary condition with no new state or prompt precedence machinery.
- The focused Assistant Runtime file passes all 305 tests, including the false-overdue timezone sequence, stale projection, automatic readback, and content-free diagnostics. Assistant Engine prompt/tool contracts pass 96 tests, and all three scripted overdue-member journeys pass. Both changed packages typecheck.
- Complete first provider-visible request bodies captured through the pinned Codex App Server with identical direct and group reminder fixtures, `gpt-5.6-terra`, low reasoning, production code mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony` grow by 51 tokens and 277 UTF-8 bytes in each route. Direct changes from 27,865 tokens / 127,340 bytes to 27,916 / 127,617; group changes from 23,738 tokens / 108,608 bytes to 23,789 / 108,885. No provider-visible field was excluded from either serialized request. The delta is entirely assembled reminder instructions; the deferred automation tool description is absent from the first request, and all other provider-visible fields are unchanged.
