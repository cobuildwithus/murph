# Simplify Codex final-response reconciliation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and owner

Reduce branching in the existing assistant-engine App Server turn runner without changing delivered replies, quiet outcomes, transcripts, or event ordering. The runner remains the sole owner of mutable event state and process cleanup. Private synchronous helpers derive final-response selection and presentation from that state.

## Evidence and design

The runner has cyclomatic complexity 102 and mixes final-output reconciliation with process lifecycle. Current/trailing response selection uses overlapping boolean expressions; promoted and final responses repeat card/workout text and transcript rendering. Replace overlapping selection predicates with explicit ordered outcomes, reuse card rendering, and separate final required-output composition. Do not add a framework, public export, or persisted state.

## Protected invariants

- Preserve trailing-candidate promotion, earlier and latest no-reply precedence, delivery ordinals, targets, media, cards, context references, and follow-up ownership.
- Preserve distinction between delivered text and semantic transcript, including tracking authority, card overflow recovery, calendar suffixes, approval URLs, and daylight-saving clarification order.
- Leave live event mutation, pending-request settlement, cancellation, process cleanup, usage accounting, and resume authority in their current order.
- No new awaited work, external calls, schemas, deployment ordering, or compatibility layers.

## Product proof

Outcome: Existing replies and silence remain identical while the code becomes easier to review.
Reaches: Ordinary text/media/card replies, live-steered earlier answers, later acknowledgements, and required recovery output.
Proof: Scripted provider-event suites assert exact output and suppression; one production-derived real-Codex acknowledgement journey checks preserved earlier reply and one later quiet action.

## Tasks

1. Introduce private final-selection and presentation helpers and remove duplicate rendering.
2. Extend focused deterministic output assertions and the existing live acknowledgement journey.
3. Run focused steering/events/recovery suites, assistant-engine typecheck, complexity guard, and focused live proof; inspect actual synthetic reply.
4. Review privacy and full diff, close this implementation plan, commit, push, and open a complete draft PR for parent review and final gates.

## Results

Implemented private ordered trailing-response selection and shared card/final-output presentation. No public API or runtime state owner was added. The event/provider lifecycle span remains byte-identical to the baseline.

- Complexity guard passes against base `3fcb0ab14d8137af4d4858ad030de8ab2c904970`: file debt 229 → 203 and maximum 102 → 76. The new private helpers remain below 20; other existing hotspots are unchanged. Total complexity is 1540 → 1541 because extracted function baselines count separately; this is a coherent boundary simplification, not a total-branch reduction claim.
- Steering suite: 45 passing after strengthening text/card/oversized tracked-card assertions. Events and recovery suites: 79 passing. An initial expected tracking timestamp mismatch in the new assertion was corrected to recognize runtime-owned snapshot refresh while retaining the complete rendered response and tracking authority assertion.
- Five focused scripted real-App-Server cases pass for DST clarification and exact calendar links/suffixes.
- Five focused trailing-selection cases pass with the original source restored temporarily, confirming baseline behavior; candidate bytes were restored afterward.
- Assistant-engine typecheck and diff whitespace checks pass.
- Focused real-Codex acknowledgement journey passes with `gpt-5.6-terra`, local subscription: the earlier answer is preserved, exactly one quiet-finish action occurs with no other dynamic calls, and final reply, media, card, follow-up, and target remain absent. Actual synthetic output inspected: Ready. The journey was repeated only to recover direct-output evidence lost across context compaction; both invocations passed.

Implementation handoff remains a draft PR. The parent owns candidate review, Ready, exact-head CI, ReviewGPT, and completion.
Completed: 2026-09-11
