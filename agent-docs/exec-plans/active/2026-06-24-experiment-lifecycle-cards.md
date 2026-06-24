Goal (incl. success criteria):
- Make the experiment lifecycle feel intentional: one early visual progress moment after three completed intervention days and one celebratory final-results moment after the run ends.
- Reuse the existing progress-card, outcome, managed-automation, and assistant media primitives; add no new persisted product state or delivery system.
- Success means eligible active runs seed stable idempotent day-four and final one-shot automations, sparse early data still produces a useful adherence-first card, final results are persisted and summarized with honest confidence, and focused tests prove dates, ids, skip boundaries, and prompt outcomes.

Constraints/Assumptions:
- Keep the change inside the assistant-engine owner and existing experiment onboarding guidance unless direct evidence requires a broader owner change.
- Preserve the existing final-results automation id so already-seeded runs update instead of duplicating.
- The response-media contract does not combine a progress-card image and voice memo in one reply; prioritize the card plus warm text, with voice as an optional fallback only when the card cannot be attached.
- Keep prompts outcome-first, concise, and explicit about validation/skip conditions; avoid a long procedural prompt stack.
- Preserve unrelated active ledger rows and avoid files owned by other active assistant-runtime lanes.

Key decisions:
- Generate both lifecycle automations from one per-experiment seed builder.
- Schedule the first progress moment on intervention day four; runs shorter than four days receive only the final result.
- Treat missing or inconclusive metric movement as a caveat, not a reason to suppress either lifecycle moment.
- Persist the deterministic outcome at final review before composing the user-facing result.

State:
- In progress.

Done:
- Traced the current progress-card data flow, managed automation seeding, final-results prompt, onboarding prompt surface, media constraints, and recent delivery/data fixes.
- Confirmed the root gap: the existing final seed is understated and the only proactive mid-run path is the global weekly digest.

Now:
- Add the minimal lifecycle seed builder and focused tests.

Next:
- Update durable onboarding guidance, run scoped verification and review, close this plan, and open the PR.

Open questions (UNCONFIRMED if needed):
- None that block implementation; mixed voice/image delivery remains deliberately out of scope for this narrow lifecycle fix.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/experiment-support-automations.ts
- packages/assistant-engine/test/experiment-support-automations.test.ts
- packages/assistant-engine/skills/experiment-onboarding/SKILL.md
- agent-docs/product-specs/experiment-onboarding.md
- pnpm typecheck
- pnpm test:diff packages/assistant-engine/src/assistant/experiment-support-automations.ts packages/assistant-engine/test/experiment-support-automations.test.ts packages/assistant-engine/skills/experiment-onboarding/SKILL.md agent-docs/product-specs/experiment-onboarding.md
