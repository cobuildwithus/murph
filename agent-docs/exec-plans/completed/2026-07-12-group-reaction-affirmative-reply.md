Goal (incl. success criteria):
- Let a member's affirmative Linq reaction to Murph's own group message act as an exact reply to that message, so a clear offer or question can continue without a follow-up text.
- Preserve PR #560's silence and deferred-context behavior for reactions to participant-authored messages.
- Success means affirmative add/remove reactions to Murph-authored targets are wakeable, retain exact target context and reply anchoring, and pass the existing hosted ingress authority, retry, and bounded-content rules.

Constraints/Assumptions:
- Build directly on the exact head of PR #560 and target its branch with a stacked PR.
- Reuse the existing conversation mailbox, Linq target lookup, Temporal handoff, and assistant input spine; add no new store, queue, classifier, or scheduler.
- Only the existing affirmative reaction vocabulary (like/love/heart/thumbs-up equivalents) qualifies.
- A reaction remains model-interpreted evidence for the exact target, not blanket authority to infer unrelated scope or bypass confirmation/payment safeguards.
- Preserve unrelated working-tree and coordination-ledger work.

Key decisions:
- Represent an affirmative reaction to a Murph-authored target as an ordinary `conversation.message` with the target message/part as its native reply anchor.
- Keep participant-targeted and non-affirmative reactions as `conversation.reaction` deferred context.
- Treat removal of an affirmative reaction to Murph's message as an actionable withdrawal so it can stop pending follow-through before an irreversible effect.
- Re-handoff duplicate actionable reaction rows, matching existing foreground ingress recovery behavior.

State:
- Complete.

Done:
- Proved PR #560 intentionally makes every reaction non-wakeable.
- Identified the existing target-author (`isFromMe`) fact and affirmative reaction vocabulary.
- Reused the ordinary conversation-message envelope and existing ingress handoff for supported affirmative reactions to Murph-authored targets, with exact message/part anchoring and duplicate re-handoff.
- Preserved deferred context for participant targets, non-affirmative reactions, and accepted react-to-join events; represented removal as a wakeable withdrawal.
- Tightened the assistant contract so only a clear yes/no question or offered action becomes confirmation; ordinary statements remain context-only and separate effect safeguards remain intact.
- Added staging, webhook handoff, duplicate, join-priority, and withdrawal proof; the focused web suite passes 48/48 and the prepared web typecheck passes.
- Completed the required coverage-write pass and security/privacy review with no unresolved coverage gap or medium-or-higher security finding.

Now:
- Ready for the scoped finish-task commit.

Next:
- Push the task branch, open the draft PR stacked on PR #560, and run the PR ReviewGPT/CI gates on the pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq-reaction.ts
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/src/lib/hosted-onboarding/linq-provider-events.ts
- apps/web/test/hosted-onboarding-linq-reaction-context.test.ts
- apps/web/test/hosted-onboarding-webhook-idempotency.test.ts
- packages/assistant-engine/skills/group-chat/SKILL.md
- agent-docs/product-specs/group-reaction-context.md
- agent-docs/operations/imessage-deliverability.md
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
