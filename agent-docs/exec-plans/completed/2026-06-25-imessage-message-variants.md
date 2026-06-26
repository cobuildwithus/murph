Goal (incl. success criteria):
- Land deterministic variants for user-facing hosted text/iMessage copy without adding runtime state, provider-layer templating, or broad messaging abstractions.
- Success means signup welcome, Linq signup/quota/redirect, and AI usage notices render from one small shared primitive, preserve existing routing/idempotency semantics, and focused tests prove deterministic selection, dynamic values, and call-site behavior.

Constraints/Assumptions:
- Treat the supplied patch as implementation intent, not overwrite authority.
- Keep the architecture simple: static variant banks plus deterministic seed selection.
- Preserve iMessage deliverability guardrails: no fake/random padding, no shortened links, and keep messages conversational and reply-oriented where the flow allows.
- Avoid broad casts and avoid new persisted state.
- Preserve unrelated active ledger rows and other worktrees.

Key decisions:
- Use a shared contracts-owned renderer so web/runtime call sites do not each grow template logic.
- Keep existing call-site builder functions as thin wrappers to avoid spreading message selection across webhook code.
- Use stable domain seeds from existing ids/period starts/effect ids.

State:
- In progress.

Done:
- Read repo workflow, verification, completion, PR review-loop, and iMessage deliverability docs.
- Read the supplied patch and pasted implementation notes.
- Created an isolated worktree and branch.

Now:
- Apply the patch, clean up implementation details, and add focused tests.

Next:
- Run verification, commit with plan closure, open PR, then run ReviewGPT rounds to zero accepted findings.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/contracts/src/user-facing-messages.ts
- packages/contracts/src/index.ts
- packages/contracts/test/user-facing-messages.test.ts
- apps/web/src/lib/hosted-onboarding/linq-replies.ts
- apps/web/src/lib/hosted-onboarding/member-activation.ts
- apps/web/src/lib/hosted-onboarding/webhook-transport.ts
- apps/web/src/lib/hosted-execution/usage-allowance.ts
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- focused apps/web and package tests
- pnpm typecheck
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
