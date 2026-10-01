# Preserve supported provider targets for retired automation pins

## Outcome and decision
Resolve the accepted PR #3670 round-one regression inside the existing automation target resolver. Inherited Terra pins must not reach Venice's rejecting product-model boundary. Preserve OpenAI upgrades, authored canonical records, explicit reasoning, occurrence identity, and literal custom-provider models. No new provider support, data migration, or live Venice integration is needed.

## Implementation
- Require current product-model eligibility together with Venice mapping support before retaining an inherited managed pin.
- Reuse the existing supported conversation-target fallback and nullable-field compactor; remove duplicate null filtering.
- Correct the composed envelope/routing retry regression and verify switching back to OpenAI. Update the architecture owner.

## Evidence
The corrected Terra regression failed before the fix. Afterward, 60 engine tests and 13 existing production Venice body-builder tests pass, as do engine typecheck and the complexity guard (maximum 18 versus base 19). A direct composition of the production envelope, target resolver, execution plan, and Venice body builder accepts GPT-5.6 Sol, preserves medium reasoning and the saved Terra pin, and resolves GPT-6 Sol when switched back to OpenAI.

The focused legacy-Luna real-Codex journey passes again with GPT-6 Luna through the local subscription: one provider request, concise expected reminder decision, no mutation or unrelated action, and unchanged canonical reminder state. Actual reply reviewed: Ready. No live Venice call or real message delivery was performed.

## Review handoff
User resumption authorized the small compatibility correction. Implementation and local proof are complete. Run substantive ReviewGPT round two as a sensitive full snapshot on the same Eragon conversation, preserving the first-reviewed head and round-one finding history; required exact-head CI remains the separate completion gate. No merge or deployment is part of this task.
Status: completed
Updated: 2026-09-23
Completed: 2026-09-23
