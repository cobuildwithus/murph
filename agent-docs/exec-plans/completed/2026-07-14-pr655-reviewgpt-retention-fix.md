Goal (incl. success criteria):
- Resolve PR #655 ReviewGPT round 1's accepted provider-retention finding without adding state or lifecycle machinery.
- Affirmative reactions in private and group Linq chats use the reaction event as inbound identity, require an exact same-route sent Murph outbox delivery, and remain actionable after provider message cleanup.
- Success means focused production-path proof, required coverage audit, green exact-head CI, and a ReviewGPT correction round with no accepted findings.

Constraints/Assumptions:
- Preserve the ordinary Linq planner as the sole ingress owner for routing, access, quotas, mailbox dedupe, and wake handoff.
- Preserve PR #651's optional lossy group-reaction context path; only the actionable affirmative path must not depend on provider retention.
- Add no schema, queue, replay path, retention extension, reconciliation state, rollout flag, dependency, or service.
- Keep outbound target identity distinct from the synthetic inbound reaction identity.
- Preserve unrelated worktrees, processes, plans, and working-tree changes.

Key decisions:
- Delete the actionable path's live target-message read.
- Carry one typed affirmative-reaction marker through the existing Linq wake and assistant-input metadata.
- Reuse the existing same-route outbox delivery lookup to attest Murph authorship and recover cross-session target context; suppress unmatched targets before reply generation.
- Do not queue synthetic reaction event IDs or reacted-to outbound IDs for inbound provider cleanup, and do not send read receipts for synthetic reactions.
- Keep each synthetic affirmative reaction in its own transient automation group so adjacent ordinary replies neither lend it trust nor share its suppression.

State:
- Local correction and completion verification passed; exact-head PR gates pending after push.

Done:
- Confirmed existing provider cleanup can delete the target before a delayed reaction webhook.
- Confirmed the assistant outbox already stores sent text, provider message IDs, session identity, and route authority for both same-session and cross-session matching.
- Removed the actionable path's provider target read and separated reaction-event identity from the outbound reply target.
- Added exact same-route sent-outbox attestation, same/cross-session proof, and synthetic read-receipt/provider-cleanup exclusions.
- Ran the required fresh coverage-write audit; its mixed ordinary-plus-reaction grouping regression was fixed at the existing transient grouping boundary with direct proof.
- Passed focused private/group, parser, mailbox-import, attestation, grouping, cleanup, and idempotency proof plus the full diff-aware affected package/app lane.

Now:
- Commit, reconcile with current main, and push the corrected head.

Next:
- Commit/rebase/push, then run ReviewGPT correction round and exact-head CI concurrently.

Open questions (UNCONFIRMED if needed):
- None.

Working set:
- apps/web/src/lib/hosted-onboarding/{webhook-provider-linq-reaction-context,webhook-provider-linq,webhook-service}.ts
- packages/hosted-execution/src/{contracts,parsers}.ts
- packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts
- packages/assistant-engine/src/assistant/{input-store,automation/{grouping,input-summary,reply}}.ts
- focused tests and ARCHITECTURE.md
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
